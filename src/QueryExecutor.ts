import { PoolClient, QueryResult } from 'pg';

export interface QueryNamedParams {
    [key: string]: any;
}

/**
 * Function to transforms a single query result row.
 */
export type QueryResultTransformFunc<T=any, R=any> = (row: R, rowNum?: number, result?: QueryResult) => T;

/**
 * Function to transform a single query result row or a string indicating a column name that must exist on the row.
 */
export type QueryResultRowTransform<T, R> = QueryResultTransformFunc<T, R> | string;

export type TransactionSuccessCallback = () => void;
export type TransactionErrorCallback = (err: Error) => void;

export enum TransactionStatus {
    UNKNOWN,
    COMMITTED,
    ROLLED_BACK,
}

export interface TransactionSynchronizationContext {
    /**
     * Date.now() when this transaction was started.
     */
    started: number;

    /**
     * Status of this transaction
     */
    status: TransactionStatus;
}

/**
 * Interface for additional work to be performed throughout the lifecycle of a transaction.
 *
 * Allows adding hooks for executing post-COMMIT work such as cache invalidation that only execute upon successful completion.
 */
export interface TransactionSynchronization {
    /**
     * Called after the work for the transaction is complete but before the COMMIT is issued.
     * Only called if the work completes successfully. If work throws an Error this function is not called.
     * If this function throws an Error then the transaction will be aborted and a ROLLBACK attempted.
     *
     * @param context TransactionContext for the inflight transaction
     */
    beforeCommit?(context?: TransactionSynchronizationContext): void | Promise<void>;

    /**
     * Called after the transaction work has completed and COMMITTED successfully.
     * If the work completes successfully but the COMMIT fails (ex: deferred constraint violation) then this function will not be called.
     * If this function throws an Error then the transaction will not be aborted as it has already been completed but the error will bubble up to the caller.
     *
     * @param context TransactionContext for the inflight transaction
     */
    afterCommit?(context?: TransactionSynchronizationContext): void | Promise<void>;

    /**
     * Called after the transaction work has completed, both successfully and errantly.
     * If this function throws an Error then the transaction will not be aborted as it has already been completed but the error will bubble up to the caller.
     *
     * @param context TransactionContext for the inflight transaction
     * @param err The Error that caused the transaction to fail or null if the transaction completed successfully.
     */
    afterCompletion?(context?: TransactionSynchronizationContext, err?: Error): void | Promise<void>;
}

export interface QueryExecutor {
    /**
     * Whether the calling context has an active transaction in progress.
     */
    isTransactionActive: boolean;

    /**
     * Fetch a connection from the underlying pool. It's the responsibily of the caller to release the connection.
     *
     * Under normal usage this function should not be necessary.
     */
    connect: () => Promise<PoolClient>;

    /**
     * Execute a unit of work with either the client associated with the current transaction or a new client from the pool.
     *
     * This function handles returning the client to the pool upon completion of the union of work.
     * The caller must not call the release(...) function on the client.
     * To protect against that it's wrapped with a proxy that throws an Error.
     *
     * @param work The unit of work to perform with the client
     * @returns The resolved value of the work function
     */
    doWithClient: <T>(work: (client: PoolClient) => Promise<T>) => Promise<T>;

    /**
     * Execute a query and return back the full pg.QueryResult.
     *
     * @param sql The SQL to execute
     * @param params Object of named parameters or an array of parameters
     */
    queryRaw(sql: string, params?: QueryNamedParams | any[]): Promise<QueryResult>;

    /**
     * Executes a query and returns back an array of results.
     * If no transform is specified then the raw rows of the result are returned back as an array.
     * If a transform is specified then it is applied to each row of the result.
     *
     * If a transaction is in progress then the client associated with the transaction will be used.
     * Otherwise a random client will be used from the connection pool.
     *
     * @param sql The SQL to execute
     * @param params Object of named parameters or an array of parameters
     * @param transform Optional row transformation to apply to each row in the result
     */
    query<T = any, R = any>(sql: string, params?: QueryNamedParams | any[], transform?: QueryResultRowTransform<T, R>): Promise<T[]>;

    /**
     * Executes a query and returns back a single result or null.
     * If no transform is specified then the raw row of the result is returned.
     * If a transform is specified then it is applied to the result row.
     *
     * If a transaction is in progress then the client associated with the transaction will be used.
     * Otherwise a random client will be used from the connection pool.
     *
     * This function expects at most one row in the result.
     * If the result contains more than one row then an Error will be raised.
     *
     * @param sql The SQL to execute
     * @param params Object of named parameters or an array of parameters
     * @param transform Optional row transformation to apply to each row in the result
     */
    queryOne<T = any, R = any>(sql: string, params?: QueryNamedParams | any[], transform?: QueryResultRowTransform<T, R>): Promise<T>;

    /**
     * Executes a DML command and return back the number of modified rows.
     *
     * If a transaction is in progress then the client associated with the transaction will be used.
     * Otherwise a random client will be used from the connection pool.
     *
     * @param sql The SQL to execute
     * @param params Object of named parameters or an array of parameters
     */
    update(sql: string, params?: QueryNamedParams | any[]): Promise<number>;

    /**
     * Similar to query(...) but requires that the caller has already started a transaction.
     * If no transaction exists then an error is thrown.
     */
    queryTx<T = any, R = any>(sql: string, params?: QueryNamedParams | any[], transform?: QueryResultRowTransform<T, R>): Promise<T[]>;

    /**
     * Similar to queryOne(...) but requires that the caller has already started a transaction.
     * If no transaction exists then an error is thrown.
     */
    queryOneTx<T = any, R = any>(sql: string, params?: QueryNamedParams | any[], transform?: QueryResultRowTransform<T, R>): Promise<T>;

    /**
     * Similar to update(...) but requires that the caller has already started a transaction.
     * If no transaction exists then an error is thrown.
     */
    updateTx(sql: string, params?: QueryNamedParams | any[]): Promise<number>;

    /**
     * Perform a series of database operations within a transaction.
     *
     * @param work The work that will be performed in a transaction.
     */
    tx<T=void>(work: () => Promise<T>): Promise<T>;

    /**
     * Add a synchronization to be executed during the transaction lifecycle.
     *
     * @param synchronization A TransactionSynchronization
     */
    registerSynchronization(synchronization: TransactionSynchronization): void;
}
