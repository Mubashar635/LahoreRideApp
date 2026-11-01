import type { Queryable } from './queryable';

export interface StoredResponse {
  requestHash: string;
  status: number | null;
  body: unknown;
}

/**
 * Tries to claim (scope, key). Returns true if this request now owns the key.
 * If another in-flight transaction holds the same key, this INSERT blocks until
 * that transaction commits (→ false, the stored response is then readable)
 * or rolls back (→ true, this request proceeds).
 */
export async function claimKey(q: Queryable, scope: string, key: string, requestHash: string): Promise<boolean> {
  const { rowCount } = await q.query(
    `INSERT INTO idempotency_keys (scope, idempotency_key, request_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT (scope, idempotency_key) DO NOTHING`,
    [scope, key, requestHash],
  );
  return rowCount === 1;
}

export async function getStoredResponse(q: Queryable, scope: string, key: string): Promise<StoredResponse | undefined> {
  const { rows } = await q.query<{ request_hash: string; response_status: number | null; response_body: unknown }>(
    `SELECT request_hash, response_status, response_body
     FROM idempotency_keys WHERE scope = $1 AND idempotency_key = $2`,
    [scope, key],
  );
  const row = rows[0];
  return row && { requestHash: row.request_hash, status: row.response_status, body: row.response_body };
}

export async function saveResponse(q: Queryable, scope: string, key: string, status: number, body: unknown): Promise<void> {
  await q.query(
    `UPDATE idempotency_keys SET response_status = $3, response_body = $4
     WHERE scope = $1 AND idempotency_key = $2`,
    [scope, key, status, JSON.stringify(body)],
  );
}
