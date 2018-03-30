import * as assert from 'assert';
import * as mocha from 'mocha';
assert.equal(mocha.name, mocha.name);
import domain = require('domain');
import { createQueryExecutor, QueryExecutorError, CreateQueryExecutorOpts } from '../lib';
import { Pool } from 'pg';

function sleep(millis: number) {
    return new Promise((resolve) => {
        setTimeout(resolve, millis);
    })
}

function getEnv(name: string, defaultValue: string = undefined) {
    let value = process.env[name];
    if (value === null || value === undefined) {
        value = defaultValue
    }
    if (value === undefined) {
        throw new Error('Missing required environment variable: ' + name);
    }
    return value;
}

function createTestQueryExecutor(opts: CreateQueryExecutorOpts = {}) {
    const databaseUrl = getEnv('DATABASE_URL');
    const pool = new Pool({
        connectionString: databaseUrl,
    });
    const logQueryTimes = process.env.LOG_QUERY_TIMES === 'true';
    return createQueryExecutor(pool, {
        ...opts,
        beforeQuery: (opts) => {
            if (logQueryTimes) {
                console.log('Will execute isTransactionActive=%s sql=%j elapsed=%s', opts.isTransactionActive, opts.sql);
            }
        },
        afterQuery: (opts) => {
            if (logQueryTimes) {
                console.log('Executed isTransactionActive=%s sql=%j elapsed=%s', opts.isTransactionActive, opts.sql, opts.elapsed);
            }
        },
    });
}

describe('QueryExecutor', () => {
    const executor = createTestQueryExecutor();
    describe('.query("SELECT 1 AS x WHERE false")', () => {
        it('should return an empty array', async () => {
            const rows = await executor.query('SELECT 1 AS x WHERE false');
            assert.ok(rows);
            assert.ok(rows.length == 0);
        });
    });
    describe('.query("SELECT 1 AS x")', () => {
        it('should return a single row as an array', async () => {
            const rows = await executor.query('SELECT 1 AS x');
            assert.ok(rows);
            assert.ok(rows.length == 1);
            assert.ok(rows[0]);
            assert.ok(rows[0].x === 1);
        });
    });
    describe('.query("SELECT x FROM generate_series(1,100) x")', () => {
        it('should return an array of 100 rows', async () => {
            const rows = await executor.query('SELECT x FROM generate_series(1,100) x');
            assert.ok(rows);
            assert.ok(rows.length == 100);
        });
    });
    describe('.query("SELECT 123 AS x", [], "x")', () => {
        it('should return an array of values', async () => {
            const rows = await executor.query('SELECT 123 AS x', [], 'x');
            assert.ok(rows);
            assert.ok(rows.length == 1);
            assert.ok(rows[0]);
            assert.ok(rows[0] === 123);
        });
    });
    describe('.query("SELECT 123 AS x", [], transform)', () => {
        it('should return an array of transformed values', async () => {
            const rows = await executor.query('SELECT 123 AS x', [], (row) => 1000 + row.x);
            assert.ok(rows);
            assert.ok(rows.length === 1);
            assert.ok(rows[0] === (1000 + 123));
        });
    });
    describe('.query("SELECT 123 AS x", [], invalidTransform)', () => {
        it('should throw and error if the transform is not a function or string', async () => {
            try {
                await executor.query('SELECT 123 AS x WHERE false', [], <any>false);
            } catch (err) {
                assert(err instanceof QueryExecutorError);
                return;
            }
            assert.fail('was supposed to fail due to the invalid transform');
        });
    });
    describe('.query("SELECT 123 AS x", [], "missing_field")', () => {
        it('should throw an error if the field is not in the result set', async () => {
            try {
                await executor.query('SELECT 123 AS x', [], 'y');
            } catch (err) {
                assert(err instanceof QueryExecutorError);
                return;
            }
            assert.fail('was supposed to fail due to missing field in result');
        });
    });

    describe('.queryOne("SELECT 1 AS x WHERE false")', () => {
        it('should return null', async () => {
            const row = await executor.queryOne('SELECT 1 AS x WHERE false');
            assert.ok(row === null);
        });
    });
    describe('.queryOne("SELECT 1 AS x")', () => {
        it('should return a single row as an object', async () => {
            const row = await executor.queryOne('SELECT 1 AS x');
            assert.ok(row);
            assert.ok(typeof (row) === 'object');
            assert.ok(row.x === 1);
        });
    });
    describe('.queryOne("SELECT x FROM generate_series(1,100) x")', () => {
        it('should throw an error that more than one row found', async () => {
            try {
                await executor.queryOne('SELECT x FROM generate_series(1,100) x');
            } catch (err) {
                // Success
                return;
            }
            assert.fail('supposed to throw an error if more than one row found');
        });
    });
    describe('.queryOne("SELECT 123 AS x", [], "x")', () => {
        it('should return a value of 123', async () => {
            const value = await executor.queryOne('SELECT 123 AS x', [], 'x');
            assert.ok(value === 123);
        });
    });
    describe('.queryOne("SELECT 123 AS x", [], transform)', () => {
        it('should return a transformed value', async () => {
            const value = await executor.queryOne('SELECT 123 AS x', [], (row) => 1000 + row.x);
            assert.ok(value === (1000 + 123));
        });
    });
    describe('.queryOne("SELECT 123 AS x", [], invalidTransform)', () => {
        it('should throw and error if the transform is not a function or string', async () => {
            try {
                await executor.queryOne('SELECT 123 AS x WHERE false', [], <any>false);
            } catch (err) {
                assert(err instanceof QueryExecutorError);
                return;
            }
            assert.fail('was supposed to fail due to the invalid transform');
        });
    });
    describe('queryOne("SELECT 123 AS x", [], "missing_field")', () => {
        it('should throw an error if the field is not in the result set', async () => {
            try {
                await executor.queryOne('SELECT 123 AS x', [], 'y');
            } catch (err) {
                assert(err instanceof QueryExecutorError);
                return;
            }
            assert.fail('was supposed to fail due to missing field in result');
        });
    });
    describe('queryOne("SELECT 123 AS x WHERE false", [], "x")', () => {
        it('should return null', async () => {
            const value = await executor.queryOne('SELECT 123 AS x WHERE false', [], "x");
            assert.ok(value === null);
        });
    });
    describe('queryOne("SELECT 123 AS x WHERE false", [], transform)', () => {
        it('should return null', async () => {
            const value = await executor.queryOne('SELECT 123 AS x WHERE false', [], (row) => row.x);
            assert.ok(value === null);
        });
    });

    describe('.queryTx(...)', () => {
        it('should throw an error when not in a transaction', async () => {
            try {
                await executor.queryTx('SELECT 1');
            } catch (err) {
                assert.ok(err instanceof QueryExecutorError);
                return;
            }
            assert.fail('supposed to throw an error if not in a transaction');
        });
    });
    describe('.queryOneTx(...)', () => {
        it('should throw an error when not in a transaction', async () => {
            try {
                await executor.queryOneTx('SELECT 1');
            } catch (err) {
                assert.ok(err instanceof QueryExecutorError);
                return;
            }
            assert.fail('supposed to throw an error if not in a transaction');
        });
    });
    describe('.updateTx(...)', () => {
        it('should throw an error when not in a transaction', async () => {
            try {
                await executor.updateTx('SELECT 1');
            } catch (err) {
                assert.ok(err instanceof QueryExecutorError);
                return;
            }
            assert.fail('supposed to throw an error if not in a transaction');
        });
    });

    describe('array parameters', () => {
        it('should be usable', async () => {
            const row = await executor.queryOne('SELECT $1::text AS x', ['test']);
            assert.ok(row);
            assert.equal(row.x, 'test');
        });
    });
    describe('named parameters', () => {
        it('should be usable', async () => {
            const row = await executor.queryOne('SELECT :name::text AS x', { name: 'test' });
            assert.ok(row);
            assert.equal(row.x, 'test');
        });
        it('should be reusable multiple times', async () => {
            const row = await executor.queryOne('SELECT :name::text AS x, :name AS y', { name: 'test' });
            assert.ok(row);
            assert.equal(row.x, 'test');
            assert.equal(row.y, 'test');
        });
        it('should throw an error if referenced but missing', async () => {
            try {
                await executor.queryOne('SELECT :name AS x', {});
            } catch (err) {
                assert.ok(err instanceof QueryExecutorError);
                return;
            }
            assert.fail('supposed to throw an error for the missing parameter');
        });
    });

    describe('queryTx', () => {
        it('should run queries when within a transaction', async () => {
            await executor.tx(async () => {
                const rows = await executor.queryTx('SELECT 1');
                assert.ok(rows);
                assert.ok(Array.isArray(rows));
            });
        })
    });
    describe('queryOneTx', () => {
        it('should run queries when within a transaction', async () => {
            await executor.tx(async () => {
                const row = await executor.queryOneTx('SELECT 1');
                assert.ok(row);
                assert.ok(!Array.isArray(row));
            });
        })
    });

    it('should throw an error if sql is not a string', async () => {
        try {
            await executor.queryOne(<any>123);
        } catch (err) {
            assert.ok(err instanceof QueryExecutorError);
            return;
        }
        assert.fail('supposed to throw an error for the bad sql type');
    });
    it('should throw an error if parameters are not an array or object', async () => {
        try {
            await executor.queryOne('SELECT :name AS x', <any>false);
        } catch (err) {
            assert.ok(err instanceof QueryExecutorError);
            return;
        }
        assert.fail('supposed to throw an error for the bad parameter type');
    });


    const getTransactionId = () => {
        return executor.queryOne<string>('SELECT txid_current() AS tx_id', [], 'tx_id');
    }
    describe('Non tx(...) usage', () => {
        it('should return a unique transaction id for each query', async () => {
            const one = await getTransactionId();
            assert.ok(one);
            const two = await getTransactionId();
            assert.notEqual(one, two);
            const three = await getTransactionId();
            assert.notEqual(two, three);
        });
    });

    describe('.tx(...)', () => {
        it('should return the result of the transaction work', async () => {
            const result = await executor.tx(async () => {
                return 123;
            });
            assert.equal(result, 123);
        });

        it('should have isTransactionActive be true within a transaction', async () => {
            await executor.tx(async () => {
                assert.ok(executor.isTransactionActive);
            });
        });

        it('should have isTransactionActive be false outside a transaction', async () => {
            assert.ok(!executor.isTransactionActive);
            await executor.tx(async () => {
                assert.ok(executor.isTransactionActive);
            });
            assert.ok(!executor.isTransactionActive);
        });

        it('should return the same transaction id for all work in a transaction', async () => {
            await executor.tx(async () => {
                const one = await getTransactionId();
                const two = await getTransactionId();
                assert.equal(one, two);
                const three = await getTransactionId();
                assert.equal(two, three);
            });
        });

        it('should have exited the domain after the transaction is complete', async () => {
            assert.ok(!process.domain, 'Should not be in a domain before the transaction');
            await executor.tx(async () => {
                await executor.query('SELECT 1');
            });
            assert.ok(!process.domain, 'Should not be in a domain after the transaction');
        });
        it('should have exited the domain after the transaction function returns but while it is running async', async () => {
            assert.ok(!process.domain, 'Should not be in a domain before the transaction');
            const transaction = executor.tx(async () => {
                await executor.query('SELECT 1');
            });
            assert.ok(!process.domain, 'Should not be in a domain while the transaction is running');
            await transaction;
            assert.ok(!process.domain, 'Should not be in a domain after the transaction is running');
        });

        it('should use an existing domain and leave it untouched', async () => {
            const d = domain.create();
            await d.run(async () => {
                const marker = Symbol();
                (<any>process.domain).marker = marker;
                await executor.tx(async () => {
                    await executor.queryOne('SELECT 1 AS x');
                });
                assert.ok(process.domain === d);
            });
            assert.ok(!process.domain);
        });

        it('should use separate connections for separate concurrent transactions', async () => {
            const doStuff = async () => {
                return executor.tx(async () => {
                    const txId = await getTransactionId();
                    await executor.query('SELECT pg_sleep(.1)')
                    return txId;
                });
            };
            const concurrency = 10;
            const tasks: Promise<string>[] = [];
            for (let i = 0; i < concurrency; i++) {
                tasks.push(doStuff());
            }
            const results = await Promise.all(tasks);
            const set: { [key: string]: boolean } = {};
            for (const txId of results) {
                if (set[txId]) {
                    throw new Error('Duplicate transaction id: ' + txId + '; results=' + JSON.stringify(results));
                }
                set[txId] = true;
            }
        });

        it('should throw an error to prevent concurrent usage of a transactional client', async () => {
            try {
                await executor.tx(async () => {
                    const stuff = executor.queryTx('SELECT 123');
                    const otherStuff = executor.queryTx('SELECT 123');
                    await Promise.all([stuff, otherStuff]);
                });
            } catch (err) {
                assert.ok(err instanceof QueryExecutorError);
                return;
            }
            assert.fail('Supposed to have thrown an error');
        });

        it('should return a different transaction id for work after a transaction', async () => {
            const txId = await executor.tx(async () => {
                const one = await getTransactionId();
                const two = await getTransactionId();
                assert.equal(one, two);
                const three = await getTransactionId();
                assert.equal(two, three);
                return one;
            });
            const afterTxId = await getTransactionId();
            assert.notEqual(txId, afterTxId);
        });

        it('should rollback work in an errant transaction', async () => {
            await executor.update('DROP TABLE IF EXISTS test_pg_exec');
            await executor.update('CREATE TABLE IF NOT EXISTS test_pg_exec (id int PRIMARY KEY)');
            const fakeError = new Error('Simulated error');
            try {
                await executor.tx(async () => {
                    await executor.update('INSERT INTO test_pg_exec (id) VALUES (1)');
                    throw fakeError;
                });
            } catch (err) {
                assert.equal(err, fakeError);
                const count = await executor.queryOne<number>('SELECT COUNT(*)::int AS count FROM test_pg_exec', [], 'count');
                assert.equal(count, 0);
                return;
            }
            assert.fail('Transaction was supposed to fail');
        });
        it('should commit work in a successful transaction', async () => {
            await executor.update('DROP TABLE IF EXISTS test_pg_exec');
            await executor.update('CREATE TABLE IF NOT EXISTS test_pg_exec (id int PRIMARY KEY)');
            await executor.tx(async () => {
                await executor.updateTx('INSERT INTO test_pg_exec (id) VALUES (1)');
                await executor.updateTx('INSERT INTO test_pg_exec (id) VALUES (2)');
                await executor.updateTx('INSERT INTO test_pg_exec (id) VALUES (3)');
            });
            const count = await executor.queryOne<number>('SELECT COUNT(*)::int AS count FROM test_pg_exec', [], 'count');
            assert.equal(count, 3);
        });
        it('default to throwing an error if it detects a nested transactions', async () => {
            try {
                await executor.tx(async () => {
                    await executor.tx(async () => {
                    });
                });
            } catch (err) {
                assert.ok(err instanceof QueryExecutorError);
                return;
            }
            assert.fail('Transaction was supposed to fail');
        });
        it('should allow beforeCommit() synchronizations to halt the commit', async () => {
            const fakeError = new Error('Simulated error');
            await executor.update('DROP TABLE IF EXISTS test_pg_exec');
            await executor.update('CREATE TABLE IF NOT EXISTS test_pg_exec (id int PRIMARY KEY)');
            try {
                await executor.tx(async () => {
                    executor.registerSynchronization({
                        beforeCommit: () => {
                            throw fakeError;
                        }
                    })
                    await executor.updateTx('INSERT INTO test_pg_exec (id) VALUES (1)');
                    await executor.updateTx('INSERT INTO test_pg_exec (id) VALUES (2)');
                    await executor.updateTx('INSERT INTO test_pg_exec (id) VALUES (3)');
                    const count = await executor.queryOne<number>('SELECT COUNT(*)::int AS count FROM test_pg_exec', [], 'count');
                    // Within the transaction we should have three rows
                    assert.equal(count, 3);
                });
                throw new Error('Transaction was supposed to fail');
            } catch (err) {
                assert.equal(err, fakeError);
            }
            // After the transaction is rolled back we should have zero rows
            const count = await executor.queryOne<number>('SELECT COUNT(*)::int AS count FROM test_pg_exec', [], 'count');
            assert.equal(count, 0);
        });
        it('should allow afterCommit() synchronizations that run after the commit', async () => {
            const fakeError = new Error('Simulated error');
            await executor.update('DROP TABLE IF EXISTS test_pg_exec');
            await executor.update('CREATE TABLE IF NOT EXISTS test_pg_exec (id int PRIMARY KEY)');
            try {
                await executor.tx(async () => {
                    executor.registerSynchronization({
                        afterCommit: () => {
                            throw fakeError;
                        }
                    })
                    await executor.updateTx('INSERT INTO test_pg_exec (id) VALUES (1)');
                    await executor.updateTx('INSERT INTO test_pg_exec (id) VALUES (2)');
                    await executor.updateTx('INSERT INTO test_pg_exec (id) VALUES (3)');
                    const count = await executor.queryOne<number>('SELECT COUNT(*)::int AS count FROM test_pg_exec', [], 'count');
                    // Within the transaction we should have three rows
                    assert.equal(count, 3);
                });
                throw new Error('Transaction was supposed to fail');
            } catch (err) {
                assert.equal(err, fakeError);
            }
            // After the transaction was committed so we should have three rows
            const count = await executor.queryOne<number>('SELECT COUNT(*)::int AS count FROM test_pg_exec', [], 'count');
            assert.equal(count, 3);
        });
        it('should allow afterCompletion() synchronizations that run after the commit', async () => {
            await executor.update('DROP TABLE IF EXISTS test_pg_exec');
            await executor.update('CREATE TABLE IF NOT EXISTS test_pg_exec (id int PRIMARY KEY)');
            let wasCalled = false;
            await executor.tx(async () => {
                executor.registerSynchronization({
                    afterCompletion: async () => {
                        await sleep(100);
                        wasCalled = true;
                    }
                })
                await executor.updateTx('INSERT INTO test_pg_exec (id) VALUES (1)');
                await executor.updateTx('INSERT INTO test_pg_exec (id) VALUES (2)');
                await executor.updateTx('INSERT INTO test_pg_exec (id) VALUES (3)');
                const count = await executor.queryOne<number>('SELECT COUNT(*)::int AS count FROM test_pg_exec', [], 'count');
                // Within the transaction we should have three rows
                assert.equal(count, 3);
            });
            assert.ok(wasCalled);
            // After the transaction was committed so we should have three rows
            const count = await executor.queryOne<number>('SELECT COUNT(*)::int AS count FROM test_pg_exec', [], 'count');
            assert.equal(count, 3);
        });

        it('should call afterCompletion() synchronizations with the error that failed the transaction', async () => {
            const fakeError = new Error('Simulated error');
            let afterCompletionErrorMatches = false;
            try {
                await executor.tx(async () => {
                    executor.registerSynchronization({
                        afterCompletion: async (context, err) => {
                            afterCompletionErrorMatches = err === fakeError;
                        }
                    })
                    await executor.query('SELECT 123');
                    await executor.query('SELECT 456');
                    throw fakeError;
                });
            } catch (err) {
                assert(err === fakeError);
                assert(afterCompletionErrorMatches, 'After completion callback should have been called with the same error');
                return;
            }
            assert.fail('Was supposed to fail the previous transaction');
        });
    });

    it('should combine work in nested transactions', async () => {
        const nestedTxExecutor = createTestQueryExecutor({
            allowNestedTransactions: true,
        });
        const getTransactionId = () => {
            return nestedTxExecutor.queryOne<string>('SELECT txid_current() AS tx_id', [], 'tx_id');
        }
        await nestedTxExecutor.update('DROP TABLE IF EXISTS test_pg_exec');
        await nestedTxExecutor.update('CREATE TABLE IF NOT EXISTS test_pg_exec (id int PRIMARY KEY)');
        await nestedTxExecutor.tx(async () => {
            const outerTxId = await getTransactionId();
            await nestedTxExecutor.update('INSERT INTO test_pg_exec (id) VALUES (1)');
            await nestedTxExecutor.update('INSERT INTO test_pg_exec (id) VALUES (2)');
            await nestedTxExecutor.update('INSERT INTO test_pg_exec (id) VALUES (3)');
            await nestedTxExecutor.tx(async () => {
                const innerTxId = await getTransactionId();
                assert.equal(outerTxId, innerTxId);
                await nestedTxExecutor.update('INSERT INTO test_pg_exec (id) VALUES (4)');
                await nestedTxExecutor.update('INSERT INTO test_pg_exec (id) VALUES (5)');
                await nestedTxExecutor.update('INSERT INTO test_pg_exec (id) VALUES (6)');
            });
        });
        const count = await nestedTxExecutor.queryOne<number>('SELECT COUNT(*)::int AS count FROM test_pg_exec', [], 'count');
        assert.equal(count, 6);
    });

    describe('.connect()', () => {
        it('should create a connection to the pool', async () => {
            const client = await executor.connect();
            try {
                await client.query('SELECT 1');
                client.release();
            } catch (err) {
                client.release(err);
                throw err;
            }
        });
    });

    describe('.doWithClient(...)', () => {
        it('should return a usable client', async () => {
            await executor.doWithClient(async (client) => {
                const result = await client.query('SELECT txid_current() AS tx_id');
                const txId = result.rows[0].tx_id;
                assert.ok(txId);
            });
        });
        it('within a transaction should return the transaction client', async () => {
            const txId = await executor.tx(async () => {
                const txId = await getTransactionId();
                assert.ok(txId);
                await executor.doWithClient(async (client) => {
                    const innerTxId = (await client.query('SELECT txid_current() AS tx_id')).rows[0].tx_id;
                    assert.equal(innerTxId, txId);
                });
                const afterTxId = await getTransactionId();
                assert.equal(afterTxId, txId);
                return txId;
            });
            const postTxId = await getTransactionId();
            assert.notEqual(txId, postTxId);
        });
        it('should throw an error if we try to release the client ourselves', async () => {
            try {
                await executor.doWithClient(async (client) => {
                    client.release();
                });
            } catch (err) {
                assert.ok(err);
                assert.ok(err instanceof QueryExecutorError);
                return
            }
            assert.fail('Was supposed to throw an error');
        });
    });
});
