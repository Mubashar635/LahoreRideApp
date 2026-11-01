import type { Pool, PoolClient } from 'pg';

/** Repositories accept either the pool or a transaction client, so callers decide the transaction boundary. */
export type Queryable = Pool | PoolClient;
