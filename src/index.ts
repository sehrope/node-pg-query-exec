import domain = require('domain');
import { Pool, PoolClient, QueryResult } from 'pg';

import NamedParams = require('./named-params');
import { QueryExecutor, QueryNamedParams, QueryResultRowTransform, TransactionStatus, TransactionSynchronization, TransactionSynchronizationContext } from './QueryExecutor';
import { QueryExecutorError } from './QueryExecutorError';

export { QueryExecutor };
export { QueryExecutorError };

interface TransactionContext {
    /**
     * Date.now() at transaction start. Useful for tracking total elapsed time of a transaction.
     */
    started: number;

    /**
     * Client connection to be used for all database interactions by this transaction.
     */
    client: PoolClient;
    /**
     * Unique id of this transaction.
     */
    id: string;

    /**
     * Current status of this transaction.
     */
    status: TransactionStatus;

    /**
     * Number of queries that are being concurrent executed in this transaction.
     * Used to track and prevent non-sequential transactional operations.
     */
    numExecutingQueries: number;

    /**
     * List of transaction synchronizations to perform throughout lifecycle.
     */
    synchronizations: TransactionSynchronization[];
}

export interface BeforeQueryCallbackOpts {
    sql: string;
    rawSql: string;
    params: QueryNamedParams | any[];
    rawParams: any[];
    isTransactionActive: boolean;
}
export interface AfterQueryCallbackOpts extends BeforeQueryCallbackOpts {
    elapsed: number;
    err: Error;
    result: QueryResult;
}

export interface CreateQueryExecutorOpts {
    name?: string;
    beforeQuery?: (opts: BeforeQueryCallbackOpts) => void | Promise<void>;
    afterQuery?: (opts: AfterQueryCallbackOpts) => void | Promise<void>;
    allowNestedTransactions?: boolean;
    allowConcurrentQueryInTransaction?: boolean;
}

export function createQueryExecutor(pool: Pool, opts: CreateQueryExecutorOpts = {}): QueryExecutor {
    // Unique id for this executor. Used for keying transaction context.
    const id = Symbol('QueryExecutor-' + opts.name);
    let txIdCounter = 0;
    const genTransactionId = () => {
        txIdCounter += 1;
        return '' + txIdCounter;
    };
    const createQueryExecutorError = (message: string, sql?: string, params?: QueryNamedParams | any[]): QueryExecutorError => {
        const txContext = getTransactionContext();
        return new QueryExecutorError(message, {
            id,
            txId: txContext ? txContext.id : null,
            sql,
            params,
        });
    };
    const getTransactionContext = (): TransactionContext => {
        const activeDomain: any = process.domain;
        if (activeDomain && activeDomain[id] && activeDomain[id].tx) {
            return activeDomain[id].tx;
        }
        return null;
    };
    const isTransactionActive = () => {
        const tx = getTransactionContext();
        return tx != null;
    };
    const wrapClient = (client: PoolClient) => {
        return new Proxy<PoolClient>(client, {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            get(target, prop, receiver) {
                if (prop === 'release') {
                    return () => {
                        throw createQueryExecutorError('Callers should not call release() on pooled clients');
                    };
                }
                return (<any>target)[prop];
            },
        });
    };
    const doWithClient = async <T>(work: (client: PoolClient) => Promise<T>): Promise<T> => {
        const txContext = getTransactionContext();
        if (txContext) {
            // We're in a transaction so hand back the client associated with the transaction
            const client = txContext.client;
            // We don't need to release the client after work is completed as the wrapping transaction will handle that
            return work(wrapClient(client));
        } else {
            // We're not in a transaction so fetch a fresh client from the pool
            const client = await pool.connect();
            try {
                // Allow the caller to perform their work
                const result = await work(wrapClient(client));
                // If we get here then the overall operation was successful so return the connection to the pool
                client.release();
                // Finally return the result
                return result;
            } catch (err) {
                // If an error occurred performing the caller's work then instruct the pool to discard the connection
                client.release(err);
                // Then re-throw the underlying error
                throw err;
            }
        }
    };
    const queryRaw = async (sql: string, params?: QueryNamedParams | any[]): Promise<QueryResult> => {
        if (typeof (sql) !== 'string') {
            throw createQueryExecutorError('Invalid type for sql:' + typeof (sql));
        }
        let rawSql: string;
        let rawParams: any[];
        if (params === null || params === undefined) {
            rawSql = sql;
            rawParams = [];
        } else if (Array.isArray(params)) {
            rawSql = sql;
            rawParams = params;
        } else if (typeof (params) === 'object') {
            const parsedSql = NamedParams.parse(sql);
            rawSql = parsedSql.sql;
            try {
                rawParams = NamedParams.convertParamValues(parsedSql, params);
            } catch (err) {
                throw createQueryExecutorError(err.message);
            }
        } else {
            throw createQueryExecutorError('Invalid type for params: ' + typeof (sql));
        }
        const tx = getTransactionContext();
        if (opts.beforeQuery) {
            await opts.beforeQuery({
                sql,
                params,
                rawSql,
                rawParams,
                isTransactionActive: tx != null,
            });
        }
        const started = Date.now();
        let queryErr: Error = null;
        let result: QueryResult = null;
        // NOTE: We explicitly await the result here to ensure the finally gets evaluated after it completes
        try {
            if (tx) {
                if (!opts.allowConcurrentQueryInTransaction && tx.numExecutingQueries > 0) {
                    throw createQueryExecutorError('Concurrent usage of transactional clients is disabled');
                }
                tx.numExecutingQueries += 1;
                try {
                    result = await tx.client.query(rawSql, rawParams);
                    return result;
                } finally {
                    tx.numExecutingQueries -= 1;
                }
            } else {
                result = await pool.query(rawSql, rawParams);
                return result;
            }
        } catch (err) {
            queryErr = err;
            throw err;
        } finally {
            if (opts.afterQuery) {
                await opts.afterQuery({
                    sql,
                    params,
                    rawSql,
                    rawParams,
                    isTransactionActive: tx != null,
                    elapsed: Date.now() - started,
                    err: queryErr,
                    result,
                });
            }
        }
    };
    const query = async <T = any, R = any>(sql: string, params?: QueryNamedParams | any[], transform?: QueryResultRowTransform<T, R>): Promise<T[]> => {
        const result = await queryRaw(sql, params);
        if (transform === undefined || transform === null) {
            return result.rows;
        } else if (typeof (transform) === 'string') {
            const columnName = transform;
            const field = result.fields.find((item) => item.name === columnName);
            if (!field) {
                throw createQueryExecutorError('Query result does not have requested property: ' + columnName);
            }
            return result.rows.map((row) => row[columnName]);
        } else if (typeof (transform) === 'function') {
            return result.rows.map((row, index) => transform(row, index + 1, result));
        }
        throw createQueryExecutorError('Invalid transform: ' + typeof (transform));
    };
    const queryOne = async <T = any, R = any>(sql: string, params?: QueryNamedParams | any[], transform?: QueryResultRowTransform<T, R>): Promise<T> => {
        const result = await queryRaw(sql, params);
        if (result.rows.length > 1) {
            throw createQueryExecutorError('Expected 1 row but found: ' + result.rows.length);
        }
        // NOTE: We don't exit early if the length is zero here to allow for further validations
        if (transform === undefined || transform === null) {
            if (result.rows.length === 0) {
                return null;
            }
            return result.rows[0];
        } else if (typeof (transform) === 'string') {
            const columnName = transform;
            const field = result.fields.find((item) => item.name === columnName);
            if (!field) {
                throw createQueryExecutorError('Query result does not have requested property: ' + columnName);
            }
            if (result.rows.length === 0) {
                return null;
            }
            return result.rows[0][columnName];
        } else if (typeof (transform) === 'function') {
            if (result.rows.length === 0) {
                return null;
            }
            return transform(result.rows[0], 1, result);
        }
        throw createQueryExecutorError('Invalid transform: ' + typeof (transform));
    };
    const update = async (sql: string, params?: QueryNamedParams | any[]): Promise<number> => {
        const result = await queryRaw(sql, params);
        return result.rowCount;
    };
    const tx = async <T=void>(work: () => Promise<T>): Promise<T> => {
        if (isTransactionActive()) {
            if (!opts.allowNestedTransactions) {
                throw createQueryExecutorError('Nested transactions are disabled');
            }
            // Explicitly allowing nested transactions so perform the work directly
            return work();
        }
        const transactionId = genTransactionId();
        const client = await pool.connect();
        let txDomain: any;
        let newTxDomain: domain.Domain;
        if (process.domain) {
            // Found an existing domain so we'll use that
            txDomain = process.domain;
        } else {
            // No existing domain so create a new one
            newTxDomain = domain.create();
            txDomain = newTxDomain;
        }
        const txContext: TransactionContext = {
            started: Date.now(),
            client,
            numExecutingQueries: 0,
            id: transactionId,
            status: TransactionStatus.UNKNOWN,
            synchronizations: [],
        };
        const getTransactionSyncronizationContext = (): TransactionSynchronizationContext => {
            return {
                started: txContext.started,
                status: txContext.status,
            };
        };
        txDomain[id] = {
            tx: txContext,
        };
        let txErr: Error = null;
        try {
            await client.query('BEGIN');
            const result = await txDomain.run(work);
            for (const synchronization of txContext.synchronizations) {
                if (synchronization.beforeCommit) {
                    await txDomain.run(synchronization.beforeCommit, getTransactionSyncronizationContext());
                }
            }
            await client.query('COMMIT');
            txContext.status = TransactionStatus.COMMITTED;
            // Return the connection to the pool
            client.release();
            return result;
        } catch (err) {
            // Save the Error so we can pass it to the completion callback
            txErr = err;
            try {
                await client.query('ROLLBACK');
            } catch (rollbackErr) {
                // NOTE: We ignore errors encountered during ROLLBACK
            }
            txContext.status = TransactionStatus.ROLLED_BACK;
            // Instruct the pool to discard the connection as an error occurred using it
            client.release(err);
            throw err;
        } finally {
            delete txDomain[id];
            if (newTxDomain) {
                // We created this domain so make sure we exit from it
                newTxDomain.exit();
            }
            // NOTE: These synchronizations do not run in the domain as they occur after transaction completion
            for (const synchronization of txContext.synchronizations) {
                // Only run afterCommit() if we actually committed the transaction
                if (txContext.status === TransactionStatus.COMMITTED && synchronization.afterCommit) {
                    await synchronization.afterCommit(getTransactionSyncronizationContext());
                }
                if (synchronization.afterCompletion) {
                    await synchronization.afterCompletion(getTransactionSyncronizationContext(), txErr);
                }
            }
        }
    };
    const registerSynchronization = (synchronization: TransactionSynchronization) => {
        ensureTransactionActive();
        getTransactionContext().synchronizations.push(synchronization);
    };
    const ensureTransactionActive = () => {
        if (!isTransactionActive()) {
            throw createQueryExecutorError('A database transaction is required but none is in progress');
        }
    };
    const queryTx = async <T = any, R = any>(sql: string, params?: QueryNamedParams | any[], transform?: QueryResultRowTransform<T, R>): Promise<T[]> => {
        ensureTransactionActive();
        return query(sql, params, transform);
    };
    const queryOneTx = async <T = any, R = any>(sql: string, params?: QueryNamedParams | any[], transform?: QueryResultRowTransform<T, R>): Promise<T> => {
        ensureTransactionActive();
        return queryOne(sql, params, transform);
    };
    const updateTx = async (sql: string, params?: QueryNamedParams | any[]): Promise<number> => {
        ensureTransactionActive();
        return update(sql, params);
    };
    return {
        connect: () => {
            return pool.connect();
        },
        doWithClient,
        queryRaw,
        query,
        queryOne,
        update,
        tx,
        registerSynchronization,
        get isTransactionActive() {
            return isTransactionActive();
        },
        queryTx,
        queryOneTx,
        updateTx,
    };
}
