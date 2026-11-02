import { config } from '../src/config';

/**
 * Integration tests TRUNCATE tables, so they must never point at a real database.
 * Uses TEST_DATABASE_URL, or DATABASE_URL with the database renamed to `<name>_test`.
 */
export function testDatabaseUrl(): string {
  const url = new URL(config.TEST_DATABASE_URL ?? config.DATABASE_URL);
  if (!config.TEST_DATABASE_URL) url.pathname = `${url.pathname}_test`;
  if (!url.pathname.endsWith('_test')) {
    throw new Error(`Refusing to run tests against "${url.pathname.slice(1)}": test database name must end in _test`);
  }
  return url.toString();
}
