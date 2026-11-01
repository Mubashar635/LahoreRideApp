import type { FareEstimate, Place, Ride, RideCategory } from './types';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const TIMEOUT_MS = 8000;
const MAX_RETRIES = 2;

/** Every failure surfaces as an ApiError carrying the server's machine-readable code. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Worth retrying: the server or network failed, not the request itself. */
  get retryable(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

interface RequestOptions {
  body?: unknown;
  idempotencyKey?: string;
}

/**
 * fetch wrapper with a timeout, a consistent error type, and automatic retry
 * (exponential backoff) for network/5xx failures — but ONLY when retrying is
 * safe: GET requests, or POSTs carrying an Idempotency-Key.
 */
async function request<T>(method: 'GET' | 'POST', path: string, opts: RequestOptions = {}): Promise<T> {
  const safeToRetry = method === 'GET' || Boolean(opts.idempotencyKey);
  let lastError: ApiError | undefined;

  for (let attempt = 0; attempt <= (safeToRetry ? MAX_RETRIES : 0); attempt++) {
    if (attempt > 0) await sleep(300 * 2 ** (attempt - 1));
    try {
      return await send<T>(method, path, opts);
    } catch (err) {
      lastError = err instanceof ApiError ? err : new ApiError(0, 'UNKNOWN', String(err));
      if (!lastError.retryable) throw lastError;
    }
  }
  throw lastError!;
}

async function send<T>(method: string, path: string, opts: RequestOptions): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        ...(opts.body !== undefined && { 'Content-Type': 'application/json' }),
        ...(opts.idempotencyKey && { 'Idempotency-Key': opts.idempotencyKey }),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (err) {
    if (controller.signal.aborted) throw new ApiError(0, 'TIMEOUT', 'The server took too long to respond.');
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check your connection.');
  } finally {
    clearTimeout(timer);
  }

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const e = json?.error;
    throw new ApiError(res.status, e?.code ?? 'HTTP_ERROR', e?.message ?? `Request failed (${res.status})`, e?.details, e?.requestId);
  }
  return json as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const api = {
  estimateFares: (pickup: Place, dropoff: Place) =>
    request<{ estimates: FareEstimate[] }>('POST', '/fare-estimates', { body: { pickup, dropoff } }).then((r) => r.estimates),

  createRide: (input: { riderId: string; category: RideCategory; pickup: Place; dropoff: Place }, idempotencyKey: string) =>
    request<Ride>('POST', '/rides', { body: input, idempotencyKey }),

  getRide: (id: string) => request<Ride>('GET', `/rides/${id}`),

  getActiveRide: (riderId: string) =>
    request<{ ride: Ride | null }>('GET', `/riders/${riderId}/active-ride`).then((r) => r.ride),

  acceptRide: (id: string, idempotencyKey: string) =>
    request<Ride>('POST', `/rides/${id}/accept`, { body: {}, idempotencyKey }),

  cancelRide: (id: string, idempotencyKey: string, reason?: string) =>
    request<Ride>('POST', `/rides/${id}/cancel`, { body: { actor: 'RIDER', ...(reason && { reason }) }, idempotencyKey }),

  completeRide: (id: string, idempotencyKey: string) =>
    request<Ride>('POST', `/rides/${id}/complete`, { body: {}, idempotencyKey }),
};

/** Turns any error into a short message a rider can act on. */
export function friendlyMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Something went wrong. Please try again.';
  switch (err.code) {
    case 'NETWORK_ERROR':
      return 'You appear to be offline or the server is unreachable. Please try again.';
    case 'TIMEOUT':
      return 'The server is taking too long. Please try again.';
    case 'NO_DRIVERS_AVAILABLE':
      return 'No drivers are available nearby right now. Please try again in a moment.';
    case 'ACTIVE_RIDE_EXISTS':
      return 'You already have a ride in progress.';
    case 'INVALID_STATE_TRANSITION':
      return 'This ride has already changed. Showing the latest status.';
    case 'VALIDATION_ERROR':
      return err.message === 'Request validation failed' ? 'Please check the trip details.' : err.message;
    default:
      return err.status >= 500 || err.status === 0 ? 'Something went wrong on our side. Please try again.' : err.message;
  }
}
