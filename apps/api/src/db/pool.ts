import { Pool, types, type PoolClient } from 'pg';

// pg returns NUMERIC as string by default to avoid precision loss.
// distance_km is numeric(7,2), well within double precision, so parse it.
types.setTypeParser(types.builtins.NUMERIC, (value) => Number.parseFloat(value));

export function createPool(connectionString: string): Pool {
  return new Pool({ connectionString, max: 10 });
}

/**
 * Runs `fn` inside a transaction on a dedicated connection.
 * Commits on success, rolls back on any thrown error.
 */
export async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
