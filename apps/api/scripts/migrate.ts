import { config } from '../src/config';
import { createPool } from '../src/db/pool';
import { runMigrations } from '../src/db/migrate';

async function main() {
  const pool = createPool(config.DATABASE_URL);
  try {
    const applied = await runMigrations(pool, (msg) => console.log(msg));
    console.log(applied.length ? `Done: ${applied.length} migration(s) applied.` : 'Database is up to date.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
