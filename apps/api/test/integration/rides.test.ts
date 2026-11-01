import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createRide, createTestContext, DHA, insertDriver, LIBERTY, MODEL_TOWN, resetDatabase, RIDER_A, rideBody } from '../helpers';

const { pool, app } = createTestContext();

beforeEach(() => resetDatabase(pool));
afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('POST /rides — successful creation', () => {
  it('creates a REQUESTED ride with fare snapshot and ETA', async () => {
    await insertDriver(pool, { lat: LIBERTY.lat, lng: LIBERTY.lng });

    const res = await createRide(app);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      riderId: RIDER_A,
      category: 'ECONOMY',
      status: 'REQUESTED',
      driver: null,
      pickup: LIBERTY,
      dropoff: MODEL_TOWN,
      fare: { currency: 'PKR', estimated: 410, final: null, distanceKm: 4.37, durationMin: 12 },
      pickupEtaMin: 1,
      allowedActions: ['accept', 'cancel'],
    });

    const { rows } = await pool.query('SELECT to_status, actor FROM ride_events WHERE ride_id = $1', [res.body.id]);
    expect(rows).toEqual([{ to_status: 'REQUESTED', actor: 'RIDER' }]);
  });

  it('still creates the ride when no driver is nearby (ETA unknown)', async () => {
    const res = await createRide(app);
    expect(res.status).toBe(201);
    expect(res.body.pickupEtaMin).toBeNull();
  });

  it('is readable via GET /rides/:id and the active-ride endpoint', async () => {
    const created = await createRide(app);

    const byId = await api(app, 'GET', `/rides/${created.body.id}`);
    expect(byId.status).toBe(200);
    expect(byId.body).toEqual(created.body);

    const active = await api(app, 'GET', `/riders/${RIDER_A}/active-ride`);
    expect(active.body.ride.id).toBe(created.body.id);
  });

  it('returns { ride: null } when the rider has no active ride (empty state)', async () => {
    const res = await api(app, 'GET', `/riders/${RIDER_A}/active-ride`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ride: null });
  });
});

describe('POST /rides — invalid input', () => {
  it.each([
    ['missing body fields', {}, ['riderId', 'category', 'pickup', 'dropoff']],
    ['bad rider id', rideBody({ riderId: 'not-a-uuid' }), ['riderId']],
    ['unknown category', rideBody({ category: 'BIKE' }), ['category']],
    ['empty address', rideBody({ pickup: { ...LIBERTY, address: '  ' } }), ['pickup.address']],
    ['outside Lahore', rideBody({ dropoff: { address: 'Karachi', lat: 24.86, lng: 67.0 } }), ['dropoff']],
    ['latitude out of range', rideBody({ pickup: { ...LIBERTY, lat: 120 } }), ['pickup.lat']],
    ['coordinates as strings', rideBody({ pickup: { ...LIBERTY, lat: '31.5' } }), ['pickup.lat']],
    ['pickup equals destination', rideBody({ dropoff: LIBERTY }), ['dropoff']],
  ])('rejects %s with 400 VALIDATION_ERROR', async (_label, body, paths) => {
    const res = await api(app, 'POST', '/rides', body, { 'idempotency-key': 'k1' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.requestId).toBeTypeOf('string');
    const reported = res.body.error.details.map((d: { path: string }) => d.path);
    for (const p of paths) expect(reported).toContain(p);
  });

  it('rejects malformed JSON with the same error envelope', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/rides',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'k' },
      payload: '{not json',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('BAD_REQUEST');
  });

  it('returns 404 for an unknown rider', async () => {
    const res = await createRide(app, { riderId: '99999999-9999-4999-8999-999999999999' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('RIDER_NOT_FOUND');
  });

  it('returns 404 for an unknown ride and 400 for a malformed ride id', async () => {
    expect((await api(app, 'GET', '/rides/99999999-9999-4999-8999-999999999999')).body.error.code).toBe('RIDE_NOT_FOUND');
    expect((await api(app, 'GET', '/rides/123')).status).toBe(400);
  });
});

describe('POST /fare-estimates', () => {
  it('quotes both categories with ETA from the nearest available driver', async () => {
    await insertDriver(pool, { category: 'ECONOMY', lat: LIBERTY.lat, lng: LIBERTY.lng });

    const res = await api(app, 'POST', '/fare-estimates', { pickup: LIBERTY, dropoff: MODEL_TOWN });

    expect(res.status).toBe(200);
    expect(res.body.estimates).toEqual([
      expect.objectContaining({ category: 'ECONOMY', estimatedFare: 410, pickupEtaMin: 1, driversAvailable: true }),
      expect.objectContaining({ category: 'COMFORT', estimatedFare: 630, pickupEtaMin: null, driversAvailable: false }),
    ]);
  });

  it('validates the trip like ride creation does', async () => {
    const res = await api(app, 'POST', '/fare-estimates', { pickup: LIBERTY, dropoff: { address: 'x', lat: 0, lng: 0 } });
    expect(res.status).toBe(400);
  });

  it('ETA reflects the nearest driver, not any driver', async () => {
    await insertDriver(pool, { lat: DHA.lat, lng: DHA.lng });
    const far = (await api(app, 'POST', '/fare-estimates', { pickup: LIBERTY, dropoff: MODEL_TOWN })).body.estimates[0];
    await insertDriver(pool, { lat: LIBERTY.lat, lng: LIBERTY.lng });
    const near = (await api(app, 'POST', '/fare-estimates', { pickup: LIBERTY, dropoff: MODEL_TOWN })).body.estimates[0];
    expect(near.pickupEtaMin).toBeLessThan(far.pickupEtaMin);
  });
});
