import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, friendlyMessage } from './api';

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const fail = (status: number, code: string) =>
  new Response(JSON.stringify({ error: { code, message: code, requestId: 'req-1' } }), { status });

function mockFetch(...responses: Array<Response | Error>) {
  const fn = vi.fn();
  for (const r of responses) r instanceof Error ? fn.mockRejectedValueOnce(r) : fn.mockResolvedValueOnce(r);
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('parses the error envelope into an ApiError with the server code', async () => {
    mockFetch(fail(409, 'NO_DRIVERS_AVAILABLE'));
    const err = await api.acceptRide('r1', 'key').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: 'NO_DRIVERS_AVAILABLE', requestId: 'req-1' });
  });

  it('does not retry client errors (4xx)', async () => {
    const fetch = mockFetch(fail(400, 'VALIDATION_ERROR'));
    await expect(api.getRide('r1')).rejects.toBeInstanceOf(ApiError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries a GET after a server error, then succeeds', async () => {
    const fetch = mockFetch(fail(503, 'UNAVAILABLE'), ok({ id: 'r1' }));
    await expect(api.getRide('r1')).resolves.toEqual({ id: 'r1' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retries a POST carrying an Idempotency-Key with the SAME key', async () => {
    const fetch = mockFetch(new TypeError('Failed to fetch'), ok({ id: 'r1' }));
    await api.cancelRide('r1', 'cancel-key');
    expect(fetch).toHaveBeenCalledTimes(2);
    const keys = fetch.mock.calls.map(([, init]) => (init.headers as Record<string, string>)['Idempotency-Key']);
    expect(keys).toEqual(['cancel-key', 'cancel-key']);
  });

  it('never retries a POST without an Idempotency-Key (could duplicate side effects)', async () => {
    const fetch = mockFetch(fail(503, 'UNAVAILABLE'), ok({ estimates: [] }));
    const place = { address: 'A', lat: 31.5, lng: 74.3 };
    await expect(api.estimateFares(place, place)).rejects.toMatchObject({ status: 503 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reports NETWORK_ERROR after exhausting retries when offline', async () => {
    mockFetch(new TypeError('x'), new TypeError('x'), new TypeError('x'));
    await expect(api.getRide('r1')).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  });
});

describe('friendlyMessage', () => {
  it('maps known codes to rider-facing text and hides server internals', () => {
    expect(friendlyMessage(new ApiError(409, 'NO_DRIVERS_AVAILABLE', 'x'))).toMatch(/no drivers/i);
    expect(friendlyMessage(new ApiError(0, 'NETWORK_ERROR', 'x'))).toMatch(/offline/i);
    expect(friendlyMessage(new ApiError(500, 'INTERNAL_ERROR', 'stack trace here'))).not.toMatch(/stack/);
    expect(friendlyMessage(new Error('boom'))).toMatch(/something went wrong/i);
  });
});
