import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createRide, createTestContext, insertDriver, resetDatabase, RIDER_A, rideBody } from '../helpers';

/*
 * These tests fire requests truly in parallel. The app runs in-process, but
 * every request uses its own pooled Postgres connection, so the row locks,
 * SKIP LOCKED and unique indexes are exercised exactly as in production.
 */
const { pool, app } = createTestContext();

beforeEach(() => resetDatabase(pool));
afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('concurrent driver acceptance', () => {
  it('10 different drivers accepting the same ride at once: exactly one wins', async () => {
    const drivers = await Promise.all(Array.from({ length: 10 }, () => insertDriver(pool)));
    const ride = await createRide(app);

    const results = await Promise.all(
      drivers.map((d) => api(app, 'POST', `/rides/${ride.body.id}/accept`, { driverId: d.id })),
    );

    const winners = results.filter((r) => r.status === 200);
    const losers = results.filter((r) => r.status !== 200);
    expect(winners).toHaveLength(1);
    expect(losers.every((r) => r.status === 409 && r.body.error.code === 'INVALID_STATE_TRANSITION')).toBe(true);

    // Exactly one driver is busy, and it is the one recorded on the ride.
    const busy = await pool.query(`SELECT id FROM drivers WHERE status = 'ON_TRIP'`);
    expect(busy.rows).toEqual([{ id: winners[0]!.body.driver.id }]);
    const events = await pool.query(`SELECT count(*)::int AS n FROM ride_events WHERE to_status = 'ACCEPTED'`);
    expect(events.rows[0].n).toBe(1);
  });

  it('auto-dispatching many rides at once never assigns one driver twice', async () => {
    const DRIVERS = 5;
    const RIDES = 8;
    await Promise.all(Array.from({ length: DRIVERS }, () => insertDriver(pool)));
    const riderIds = Array.from({ length: RIDES }, (_, i) => `00000000-0000-4000-8000-1000000000${String(i).padStart(2, '0')}`);
    for (const id of riderIds) {
      await pool.query(`INSERT INTO riders (id, name, phone) VALUES ($1, 'R', $2)`, [id, `+9211${id.slice(-6)}`]);
    }
    const rides = await Promise.all(riderIds.map((riderId) => createRide(app, { riderId })));

    const results = await Promise.all(rides.map((r) => api(app, 'POST', `/rides/${r.body.id}/accept`, {})));

    const accepted = results.filter((r) => r.status === 200);
    expect(accepted).toHaveLength(DRIVERS); // every driver used once…
    const assigned = accepted.map((r) => r.body.driver.id);
    expect(new Set(assigned).size).toBe(DRIVERS); // …and no driver twice
    expect(results.filter((r) => r.status === 409).every((r) => r.body.error.code === 'NO_DRIVERS_AVAILABLE')).toBe(true);
  });

  it('accept racing cancel: the ride ends in exactly one consistent state', async () => {
    const driver = await insertDriver(pool);
    const ride = await createRide(app);

    const [accept, cancel] = await Promise.all([
      api(app, 'POST', `/rides/${ride.body.id}/accept`, { driverId: driver.id }),
      api(app, 'POST', `/rides/${ride.body.id}/cancel`, {}),
    ]);

    const final = (await api(app, 'GET', `/rides/${ride.body.id}`)).body;
    const { rows } = await pool.query('SELECT status FROM drivers WHERE id = $1', [driver.id]);
    if (final.status === 'CANCELLED') {
      // Either cancel won outright, or accept won and cancel then released the driver.
      expect(cancel.status).toBe(200);
      expect(rows[0].status).toBe('AVAILABLE');
    } else {
      expect(final.status).toBe('ACCEPTED');
      expect(accept.status).toBe(200);
      expect(rows[0].status).toBe('ON_TRIP');
    }
  });
});

describe('duplicate requests and retries', () => {
  it('a retried POST /rides with the same key returns the original ride, not a new one', async () => {
    const first = await createRide(app, {}, 'retry-key-1');
    const retry = await createRide(app, {}, 'retry-key-1');

    expect(retry.status).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body).toEqual(first.body);
    expect((await pool.query('SELECT count(*)::int AS n FROM rides')).rows[0].n).toBe(1);
  });

  it('10 simultaneous submissions with the same key create exactly one ride', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => createRide(app, {}, 'double-tap')));

    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect((await pool.query('SELECT count(*)::int AS n FROM rides')).rows[0].n).toBe(1);
  });

  it('simultaneous submissions with DIFFERENT keys still create only one active ride per rider', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => createRide(app, {}, `key-${i}`)));

    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.error.code === 'ACTIVE_RIDE_EXISTS')).toBe(true);
  });

  it('reusing a key with a different body is rejected', async () => {
    await createRide(app, {}, 'reused');
    const res = await createRide(app, { category: 'COMFORT' }, 'reused');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('POST /rides without an Idempotency-Key is rejected', async () => {
    const res = await api(app, 'POST', '/rides', rideBody());
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('a retried accept after success replays the result instead of failing', async () => {
    await insertDriver(pool);
    const ride = await createRide(app);
    const headers = { 'idempotency-key': 'accept-1' };

    const first = await api(app, 'POST', `/rides/${ride.body.id}/accept`, {}, headers);
    const retry = await api(app, 'POST', `/rides/${ride.body.id}/accept`, {}, headers);

    expect(first.status).toBe(200);
    expect(retry.status).toBe(200); // without the key this would be 409 INVALID_STATE_TRANSITION
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body.driver.id).toBe(first.body.driver.id);
  });

  it('a failed request is not cached: the same key can be retried once the problem clears', async () => {
    const ride = await createRide(app);
    const headers = { 'idempotency-key': 'accept-when-free' };

    const noDriver = await api(app, 'POST', `/rides/${ride.body.id}/accept`, {}, headers);
    expect(noDriver.body.error.code).toBe('NO_DRIVERS_AVAILABLE');

    await insertDriver(pool);
    const retry = await api(app, 'POST', `/rides/${ride.body.id}/accept`, {}, headers);
    expect(retry.status).toBe(200);
    expect(retry.headers['idempotent-replayed']).toBeUndefined();
  });

  it('idempotency keys are scoped per rider', async () => {
    const a = await createRide(app, { riderId: RIDER_A }, 'shared-key');
    const b = await createRide(app, { riderId: '00000000-0000-4000-8000-00000000000b' }, 'shared-key');
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body.id).not.toBe(a.body.id);
  });
});
