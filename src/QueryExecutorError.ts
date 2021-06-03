import { QueryNamedParams } from './QueryExecutor';

export interface QueryExecutorErrorOpts {
    id?: symbol;
    txId?: string;
    sql?: string;
    params?: any[] | QueryNamedParams;
}

export class QueryExecutorError extends Error {
    public readonly id: symbol;
    public readonly txId: string;
    public readonly sql: string;
    public readonly params: any[] | QueryNamedParams;

    constructor(message: string, opts: QueryExecutorErrorOpts = {}) {
        super(message);
        Object.setPrototypeOf(this, QueryExecutorError.prototype);
        this.id = opts.id;
        this.txId = opts.txId;
        this.sql = opts.sql;
        this.params = opts.params;
    }

    /**
     * Override toJSON() to ensure that sensitive SQL or parameters are not logged.
     */
    public toJSON = (): Record<string, unknown> => {
        return {};
    }
}
