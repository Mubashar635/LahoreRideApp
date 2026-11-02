import type { DriverStatus, LatLng, RideCategory } from '../domain/types';
import type { Queryable } from './queryable';

export interface DriverRow {
  id: string;
  name: string;
  phone: string;
  vehicle_plate: string;
  vehicle_model: string;
  category: RideCategory;
  status: DriverStatus;
  lat: number;
  lng: number;
  location_updated_at: Date;
}

/**
 * Approximate distance in km (equirectangular projection). Accurate to well
 * under 1% at city scale and cheap to compute. Production: PostGIS
 * ST_DWithin on a GiST-indexed geography column, or Redis GEO / H3 cells.
 */
const DISTANCE_KM_SQL = `111.32 * sqrt(power(lat - $2, 2) + power((lng - $3) * cos(radians($2)), 2))`;

function nearestAvailableSql(lock: boolean): string {
  return `
    SELECT *, ${DISTANCE_KM_SQL} AS distance_km
    FROM drivers
    WHERE status = 'AVAILABLE'
      AND category = $1
      AND ${DISTANCE_KM_SQL} <= $4
    ORDER BY distance_km, id
    LIMIT 1
    ${lock ? 'FOR UPDATE SKIP LOCKED' : ''}`;
}

/** Read-only lookup used for fare quotes (no locks taken). */
export async function findNearestAvailable(
  q: Queryable,
  category: RideCategory,
  near: LatLng,
  maxKm: number,
): Promise<DriverRow | undefined> {
  const { rows } = await q.query<DriverRow>(nearestAvailableSql(false), [category, near.lat, near.lng, maxKm]);
  return rows[0];
}

/**
 * Locks and returns the nearest eligible driver.
 * SKIP LOCKED means concurrent matchers never wait on, or both pick, the same
 * driver: a driver row locked by another in-flight assignment is simply skipped.
 * Must be called inside a transaction.
 */
export async function lockNearestAvailable(
  q: Queryable,
  category: RideCategory,
  near: LatLng,
  maxKm: number,
): Promise<DriverRow | undefined> {
  const { rows } = await q.query<DriverRow>(nearestAvailableSql(true), [category, near.lat, near.lng, maxKm]);
  return rows[0];
}

/** Locks a specific driver row (waits if another transaction holds it). */
export async function lockDriverById(q: Queryable, id: string): Promise<DriverRow | undefined> {
  const { rows } = await q.query<DriverRow>('SELECT * FROM drivers WHERE id = $1 FOR UPDATE', [id]);
  return rows[0];
}

export async function setDriverStatus(q: Queryable, id: string, status: DriverStatus, location?: LatLng): Promise<void> {
  if (location) {
    await q.query(
      `UPDATE drivers SET status = $2, lat = $3, lng = $4, location_updated_at = now(), updated_at = now() WHERE id = $1`,
      [id, status, location.lat, location.lng],
    );
  } else {
    await q.query('UPDATE drivers SET status = $2, updated_at = now() WHERE id = $1', [id, status]);
  }
}

/**
 * Driver goes online/offline. Conditional update: a driver on a trip cannot
 * change availability (that is controlled by the ride lifecycle).
 * Returns the updated row, or undefined if the driver is missing or on a trip.
 */
export async function setAvailability(
  q: Queryable,
  id: string,
  status: 'AVAILABLE' | 'OFFLINE',
): Promise<DriverRow | undefined> {
  const { rows } = await q.query<DriverRow>(
    `UPDATE drivers SET status = $2, updated_at = now()
     WHERE id = $1 AND status <> 'ON_TRIP'
     RETURNING *`,
    [id, status],
  );
  return rows[0];
}

export async function findDriverById(q: Queryable, id: string): Promise<DriverRow | undefined> {
  const { rows } = await q.query<DriverRow>('SELECT * FROM drivers WHERE id = $1', [id]);
  return rows[0];
}

export async function listDrivers(q: Queryable, filter: { status?: DriverStatus; category?: RideCategory }): Promise<DriverRow[]> {
  const { rows } = await q.query<DriverRow>(
    `SELECT * FROM drivers
     WHERE ($1::driver_status IS NULL OR status = $1)
       AND ($2::ride_category IS NULL OR category = $2)
     ORDER BY name`,
    [filter.status ?? null, filter.category ?? null],
  );
  return rows;
}
