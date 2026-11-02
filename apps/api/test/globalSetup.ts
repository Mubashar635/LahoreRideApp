import { Client } from 'pg';
import { createPool } from '../src/db/pool';
import { runMigrations } from '../src/db/migrate';
import { testDatabaseUrl } from './testDatabase';

/** Runs once before all tests: creates the test database if needed and migrates it. */
export default async function setup() {
  const url = new URL(testDatabaseUrl());
  const dbName = url.pathname.slice(1);

  const admin = new Client({ connectionString: Object.assign(new URL(url), { pathname: '/postgres' }).toString() });
  await admin.connect();
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (!rowCount) await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
  } finally {
    await admin.end();
  }

  const pool = createPool(url.toString());
  try {
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
}
