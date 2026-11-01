import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createRide, createTestContext, insertDriver, resetDatabase } from '../helpers';

const { pool, app } = createTestContext();

beforeEach(async () => {
  await resetDatabase(pool);
  await insertDriver(pool);
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

type Action = 'accept' | 'cancel' | 'complete';

/** Drives a fresh ride into the given state through the public API. */
async function rideIn(state: 'REQUESTED' | 'ACCEPTED' | 'COMPLETED' | 'CANCELLED'): Promise<string> {
  const id = (await createRide(app)).body.id as string;
  if (state === 'ACCEPTED' || state === 'COMPLETED') await api(app, 'POST', `/rides/${id}/accept`, {});
  if (state === 'COMPLETED') await api(app, 'POST', `/rides/${id}/complete`, {});
  if (state === 'CANCELLED') await api(app, 'POST', `/rides/${id}/cancel`, {});
  return id;
}

describe('invalid ride-state transitions are rejected', () => {
  it.each<[Parameters<typeof rideIn>[0], Action]>([
    ['REQUESTED', 'complete'],
    ['ACCEPTED', 'accept'],
    ['COMPLETED', 'accept'],
    ['COMPLETED', 'cancel'],
    ['COMPLETED', 'complete'],
    ['CANCELLED', 'accept'],
    ['CANCELLED', 'cancel'],
    ['CANCELLED', 'complete'],
  ])('%s ride cannot %s', async (state, action) => {
    const id = await rideIn(state);
    const before = (await api(app, 'GET', `/rides/${id}`)).body;

    const res = await api(app, 'POST', `/rides/${id}/${action}`, {});

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
    expect((await api(app, 'GET', `/rides/${id}`)).body).toEqual(before); // nothing changed
  });

  it('a driver cannot cancel a ride that has no driver yet', async () => {
    const id = await rideIn('REQUESTED');
    const res = await api(app, 'POST', `/rides/${id}/cancel`, { actor: 'DRIVER' });
    expect(res.body.error.code).toBe('NO_DRIVER_ASSIGNED');
  });

  it('rejects unknown fields in transition bodies', async () => {
    const id = await rideIn('REQUESTED');
    const res = await api(app, 'POST', `/rides/${id}/cancel`, { actor: 'RIDER', refund: true });
    expect(res.status).toBe(400);
  });

  it('the database itself rejects an inconsistent row, even bypassing the service layer', async () => {
    const id = await rideIn('REQUESTED');
    await expect(
      pool.query(`UPDATE rides SET status = 'ACCEPTED', accepted_at = now() WHERE id = $1`, [id]),
    ).rejects.toThrow(/rides_status_shape/);
  });
});
