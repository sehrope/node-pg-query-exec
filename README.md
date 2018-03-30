# pg-query-exec

[![NPM](https://nodei.co/npm/pg-query-exec.png?downloads=true&downloadRank=true&stars=true)](https://nodei.co/npm/pg-query-exec/)

[![Build Status](https://travis-ci.org/sehrope/node-pg-query-exec.svg?branch=master)](https://travis-ci.org/sehrope/node-pg-query-exec)

# Overview
Pleasant wrapper for pg that supports named parameters and transactions

* [Install](#install)
* [Usage](#usage)
* [Features](#features)
* [Building and Testing](#building-and-testing)
* [License](#license)

# Install

    $ npm install pg-query-exec --save

# Dependencies

None directly but include `pg` as a peer dependency.

# Features
* Pleasant API for issuing queries.
* Named parameter support.
* Implicit transaction management.

# Usage
## Create a QueryExecutor
You should do this once in a config module then reuse the executor throughout your code:
```typescript
import pg = require('pg');
import { createQueryExecutor } from 'pg-query-exec';
const pool = new pg.Pool();
const db = createQueryExecutor(pool);
```
## Query for multiple rows
```typescript
// rows is an array
const rows = await db.query('SELECT * FROM some_table');
```

## Query with numbered parameters
```typescript
// rows is an array
const rows = await db.query('SELECT * FROM some_table WHERE name = $1', ["test"]);
```

## Query with named parameters
```typescript
// rows is an array
const params = {
    name: 'test',
}
const rows = await db.query('SELECT * FROM some_table WHERE name = :name', params);
```

## Query for a single row
```typescript
// rows is an object or null
const row = await db.queryOne('SELECT * FROM some_table WHERE id = 123');
```

## Query for a field
```typescript
// name is an any or null
const name = await db.queryOne('SELECT name FROM some_table WHERE id = 123', [], 'name')
```

## Query for a field and specify type via generic
```typescript
// name is a string or null
const name = await db.queryOne<string>('SELECT name FROM some_table WHERE id = 123', [], 'name')
```

## Perform DML
```typescript
// count is the number of rows effected
const count = await db.update('INSERT INTO foo (name) VALUES (:name)', {name: 'test'});
```

## Transform a query result
```typescript
interface FooRow {
    id: number;
    name: string;
}
class Foo {
    constructor(readonly id: number, readonly name: string) {}
}
function rowToFoo(row) {
    return new Foo(row.id, row.name);
}
// foo is an instance of Foo or null
const foo = await db.queryOne<Foo,FooRow>('SELECT * FROM foo WHERE id = :id', {id: 123}, rowToFoo);
```

# Transactions
Transactions managed using Domains.
This allows transaction demarcation to occur outside of the functions that are perform the transactional work.
Queries executed within a transaction on the same QueryExecutor will automatically join the in flight transaction and share the same client.

```typescript
// db.ts
const db: QueryExecutor = ...
export { db };

// Foo.ts
import { db } from './db';
async function createFoo(name: string) {
    return db.queryOne<string>('INSERT INTO foo (name) VALUES (:name) RETURNING id', {name}, 'id')
}

// Audit.ts
import { db } from './db';
async function save(type: string, detail: object) {
    await db.update('INSERT INTO audit (type, detail) VALUES (:type, :detail)', {type, message});
}

// controller.ts
import { db } from './db';
import Foo = require('./Foo');
import Audit = require('./Audit');
async function someRoute(req: Request, res: Response) {
    const name: string = req.body.name;
    const fooId = await db.tx(async () => {
        const id = await Foo.createFoo(name);
        await Audit.save('foo.create', {id});
    });
    res.send({ fooId });
}
```

If you want to ensure that a given operation must execute within a transaction then use the `Tx(...)` suffixed functions.
They check to ensure that a transaction is in flight and if not throw an Error:

* queryTx(...)
* queryOneTx(...)
* updateTx(...)

By default an error is thrown if multiple queries are executed concurrently in a transaction.
This means that you should not use the implicit pg query queue with transactions.
Concurrent usage of non-transactional queries is fine as each will pull a random client from the pool.

# Hooks
You can optionally add beforeQuery(...) or afterQuery(...) hooks to the QueryExecutor upon creation to be executed before and after each query is executed. This can be used to do things like log query times (probably a good idea) or transform the query results (probably a bad idea).

```typescript
const db = createQueryExecutor(pool, {
    afterQuery: (opts) => {
        if (opts.elapsed > 100) {
            console.log('Slow query sql=%j elapsed=%s', opts.sql, opts.elapsed);
        }
    },
});
```

# Building and Testing
To build the module run:

    $ make

Then, to run the tests run:

    $ make test

# License
ISC. See the file [LICENSE](LICENSE).
