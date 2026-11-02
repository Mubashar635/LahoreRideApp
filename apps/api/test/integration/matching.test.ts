import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createRide, createTestContext, DHA, driverStatus, insertDriver, JOHAR_TOWN, LIBERTY, MODEL_TOWN, resetDatabase } from '../helpers';

const { pool, app } = createTestContext();

beforeEach(() => resetDatabase(pool));
afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('driver availability and assignment', () => {
  it('auto-dispatch assigns the nearest available driver of the right category', async () => {
    const far = await insertDriver(pool, { lat: DHA.lat, lng: DHA.lng });
    const near = await insertDriver(pool, { lat: LIBERTY.lat + 0.001, lng: LIBERTY.lng });
    await insertDriver(pool, { category: 'COMFORT', lat: LIBERTY.lat, lng: LIBERTY.lng }); // closer but wrong category
    await insertDriver(pool, { status: 'OFFLINE', lat: LIBERTY.lat, lng: LIBERTY.lng }); // closer but offline

    const ride = await createRide(app);
    const res = await api(app, 'POST', `/rides/${ride.body.id}/accept`, {});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ACCEPTED');
    expect(res.body.driver.id).toBe(near.id);
    expect(res.body.allowedActions).toEqual(['cancel', 'complete']);
    expect(await driverStatus(pool, near.id)).toBe('ON_TRIP');
    expect(await driverStatus(pool, far.id)).toBe('AVAILABLE');
  });

  it('ignores drivers beyond the pickup radius', async () => {
    await insertDriver(pool, { lat: 31.7, lng: 74.55 }); // ~30 km away, still inside Lahore bounds
    const ride = await createRide(app);

    const res = await api(app, 'POST', `/rides/${ride.body.id}/accept`, {});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NO_DRIVERS_AVAILABLE');
  });

  it('returns NO_DRIVERS_AVAILABLE and leaves the ride REQUESTED when nobody is free', async () => {
    await insertDriver(pool, { status: 'OFFLINE' });
    const ride = await createRide(app);

    const res = await api(app, 'POST', `/rides/${ride.body.id}/accept`, {});
    expect(res.body.error.code).toBe('NO_DRIVERS_AVAILABLE');
    expect((await api(app, 'GET', `/rides/${ride.body.id}`)).body.status).toBe('REQUESTED');
  });

  it('a specific driver can accept, but only if available and in the right category', async () => {
    const comfort = await insertDriver(pool, { category: 'COMFORT' });
    const offline = await insertDriver(pool, { status: 'OFFLINE' });
    const ok = await insertDriver(pool);
    const ride = await createRide(app);

    const mismatch = await api(app, 'POST', `/rides/${ride.body.id}/accept`, { driverId: comfort.id });
    expect(mismatch.body.error.code).toBe('DRIVER_CATEGORY_MISMATCH');

    const unavailable = await api(app, 'POST', `/rides/${ride.body.id}/accept`, { driverId: offline.id });
    expect(unavailable.body.error.code).toBe('DRIVER_UNAVAILABLE');

    const accepted = await api(app, 'POST', `/rides/${ride.body.id}/accept`, { driverId: ok.id });
    expect(accepted.status).toBe(200);
    expect(accepted.body.driver.id).toBe(ok.id);
  });

  it('a driver already on a trip cannot accept another ride', async () => {
    const driver = await insertDriver(pool);
    const first = await createRide(app);
    await api(app, 'POST', `/rides/${first.body.id}/accept`, { driverId: driver.id });

    const second = await createRide(app, { riderId: '00000000-0000-4000-8000-00000000000b' });
    const res = await api(app, 'POST', `/rides/${second.body.id}/accept`, { driverId: driver.id });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DRIVER_UNAVAILABLE');
  });

  it('cancelling an accepted ride releases the driver', async () => {
    const driver = await insertDriver(pool);
    const ride = await createRide(app);
    await api(app, 'POST', `/rides/${ride.body.id}/accept`, {});

    const res = await api(app, 'POST', `/rides/${ride.body.id}/cancel`, { reason: 'changed plans' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'CANCELLED', cancellation: { by: 'RIDER', reason: 'changed plans' } });
    expect(await driverStatus(pool, driver.id)).toBe('AVAILABLE');
  });

  it('completing a ride sets the final fare and frees the driver at the drop-off point', async () => {
    const driver = await insertDriver(pool);
    const ride = await createRide(app);
    await api(app, 'POST', `/rides/${ride.body.id}/accept`, {});

    const res = await api(app, 'POST', `/rides/${ride.body.id}/complete`, {});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('COMPLETED');
    expect(res.body.fare.final).toBe(res.body.fare.estimated);
    const { rows } = await pool.query('SELECT status, lat, lng FROM drivers WHERE id = $1', [driver.id]);
    expect(rows[0]).toEqual({ status: 'AVAILABLE', lat: MODEL_TOWN.lat, lng: MODEL_TOWN.lng });

    const events = await pool.query('SELECT to_status FROM ride_events WHERE ride_id = $1 ORDER BY id', [ride.body.id]);
    expect(events.rows.map((r) => r.to_status)).toEqual(['REQUESTED', 'ACCEPTED', 'COMPLETED']);
  });

  it('drivers can go online/offline, but not while on a trip', async () => {
    const driver = await insertDriver(pool, { status: 'OFFLINE', lat: JOHAR_TOWN.lat, lng: JOHAR_TOWN.lng });

    const online = await api(app, 'POST', `/drivers/${driver.id}/availability`, { status: 'AVAILABLE' });
    expect(online.body.status).toBe('AVAILABLE');

    const ride = await createRide(app, { pickup: JOHAR_TOWN });
    await api(app, 'POST', `/rides/${ride.body.id}/accept`, {});

    const offline = await api(app, 'POST', `/drivers/${driver.id}/availability`, { status: 'OFFLINE' });
    expect(offline.status).toBe(409);
    expect(offline.body.error.code).toBe('DRIVER_ON_TRIP');

    const listed = await api(app, 'GET', '/drivers?status=ON_TRIP');
    expect(listed.body.drivers.map((d: { id: string }) => d.id)).toEqual([driver.id]);
  });
});
