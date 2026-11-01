import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { buildApp } from '../src/app';
import { createPool } from '../src/db/pool';
import { testDatabaseUrl } from './testDatabase';

export const RIDER_A = '00000000-0000-4000-8000-00000000000a';
export const RIDER_B = '00000000-0000-4000-8000-00000000000b';

// Places in Lahore used across tests.
export const LIBERTY = { address: 'Liberty Market', lat: 31.5104, lng: 74.3416 };
export const MODEL_TOWN = { address: 'Model Town Park', lat: 31.4834, lng: 74.3256 };
export const JOHAR_TOWN = { address: 'Johar Town', lat: 31.4697, lng: 74.2728 };
export const DHA = { address: 'DHA Phase 5', lat: 31.4697, lng: 74.4089 };

export interface TestDriver {
  id: string;
  category: 'ECONOMY' | 'COMFORT';
  status: 'OFFLINE' | 'AVAILABLE' | 'ON_TRIP';
  lat: number;
  lng: number;
}

export function createTestContext() {
  const pool = createPool(testDatabaseUrl());
  const app = buildApp({ pool });
  return { pool, app };
}

/** Empties every table and inserts fare rates + two riders. Drivers are added per test. */
export async function resetDatabase(pool: Pool): Promise<void> {
  await pool.query('TRUNCATE ride_events, rides, drivers, riders, fare_rates, idempotency_keys RESTART IDENTITY CASCADE');
  await pool.query(
    `INSERT INTO fare_rates (category, base_fare_pkr, per_km_pkr, per_min_pkr, minimum_fare_pkr)
     VALUES ('ECONOMY', 150, 45, 5, 250), ('COMFORT', 250, 65, 8, 400)`,
  );
  await pool.query(
    `INSERT INTO riders (id, name, phone) VALUES ($1, 'Rider A', '+920000000001'), ($2, 'Rider B', '+920000000002')`,
    [RIDER_A, RIDER_B],
  );
}

let driverSeq = 0;
export async function insertDriver(pool: Pool, d: Partial<TestDriver> = {}): Promise<TestDriver> {
  driverSeq += 1;
  const driver: TestDriver = {
    id: d.id ?? randomUUID(),
    category: d.category ?? 'ECONOMY',
    status: d.status ?? 'AVAILABLE',
    lat: d.lat ?? LIBERTY.lat,
    lng: d.lng ?? LIBERTY.lng,
  };
  await pool.query(
    `INSERT INTO drivers (id, name, phone, vehicle_plate, vehicle_model, category, status, lat, lng)
     VALUES ($1, $2, $3, $4, 'Test Car', $5, $6, $7, $8)`,
    [driver.id, `Driver ${driverSeq}`, `+92300${String(driverSeq).padStart(7, '0')}`, `TST-${driverSeq}`,
     driver.category, driver.status, driver.lat, driver.lng],
  );
  return driver;
}

export async function driverStatus(pool: Pool, id: string): Promise<string> {
  const { rows } = await pool.query<{ status: string }>('SELECT status FROM drivers WHERE id = $1', [id]);
  return rows[0]!.status;
}

export function rideBody(overrides: Record<string, unknown> = {}) {
  return { riderId: RIDER_A, category: 'ECONOMY', pickup: LIBERTY, dropoff: MODEL_TOWN, ...overrides };
}

type App = ReturnType<typeof buildApp>;

export async function api(app: App, method: 'GET' | 'POST', url: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await app.inject({ method, url, payload: body as object | undefined, headers });
  return { status: res.statusCode, headers: res.headers, body: res.json() as any };
}

export async function createRide(app: App, overrides: Record<string, unknown> = {}, key: string = randomUUID()) {
  return api(app, 'POST', '/rides', rideBody(overrides), { 'idempotency-key': key });
}
