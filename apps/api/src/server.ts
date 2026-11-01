import { buildApp } from './app';
import { config } from './config';
import { createPool } from './db/pool';

async function main() {
  const pool = createPool(config.DATABASE_URL);
  const app = buildApp({
    pool,
    corsOrigin: config.CORS_ORIGIN,
    logger: {
      level: config.LOG_LEVEL,
      // Never log credentials or client-supplied secrets.
      redact: ['req.headers.authorization', 'req.headers.cookie'],
      ...(config.NODE_ENV === 'development' && {
        transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
      }),
    },
  });

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    await app.close(); // stops accepting requests, finishes in-flight ones
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.PORT, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
