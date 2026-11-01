import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../db/pool';
import { Errors } from '../errors';
import * as keys from '../repositories/idempotencyRepository';

export interface IdempotencyContext {
  scope: string;
  key?: string;
  body: unknown;
}

export interface IdempotentResult<T> {
  status: number;
  body: T;
  replayed: boolean;
}

/**
 * Runs `action` exactly once per (scope, Idempotency-Key).
 *
 * The key is claimed INSIDE the same transaction as the business change, so
 * the two are atomic: either both commit (key + stored response + ride change)
 * or neither does. Consequences:
 *  - Retry after success → the stored response is replayed; nothing runs twice.
 *  - Retry after failure → the key was rolled back too, so the retry runs fresh
 *    (failures like NO_DRIVERS_AVAILABLE are transient and must be retryable).
 *  - Two identical requests at the same instant → the second blocks on the key's
 *    primary key until the first commits, then replays its response.
 *  - Same key, different body → 422, a client bug we should surface.
 *
 * Without a key the action simply runs in a transaction.
 */
export async function runIdempotent<T>(
  pool: Pool,
  ctx: IdempotencyContext,
  successStatus: number,
  action: (tx: PoolClient) => Promise<T>,
): Promise<IdempotentResult<T>> {
  return withTransaction(pool, async (tx) => {
    if (!ctx.key) {
      return { status: successStatus, body: await action(tx), replayed: false };
    }

    const hash = hashBody(ctx.body);
    const claimed = await keys.claimKey(tx, ctx.scope, ctx.key, hash);
    if (!claimed) {
      const stored = await keys.getStoredResponse(tx, ctx.scope, ctx.key);
      if (stored && stored.requestHash !== hash) throw Errors.idempotencyKeyReused();
      if (stored && stored.status !== null) {
        return { status: stored.status, body: stored.body as T, replayed: true };
      }
    }

    const body = await action(tx);
    await keys.saveResponse(tx, ctx.scope, ctx.key, successStatus, body);
    return { status: successStatus, body, replayed: false };
  });
}

/** Stable hash of a JSON body (object keys sorted, so key order does not matter). */
export function hashBody(body: unknown): string {
  return createHash('sha256').update(stableStringify(body ?? null)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
