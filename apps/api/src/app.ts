import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import Fastify, { type FastifyServerOptions } from 'fastify';
import type { Pool } from 'pg';
import { AppError } from './errors';
import { driverRoutes } from './http/routes/drivers';
import { fareRoutes } from './http/routes/fares';
import { rideRoutes } from './http/routes/rides';

export interface AppDeps {
  pool: Pool;
  logger?: FastifyServerOptions['logger'];
  corsOrigin?: string;
}

/** Builds the HTTP app. Kept separate from server.ts so tests can run it in-process via app.inject(). */
export function buildApp({ pool, logger = false, corsOrigin }: AppDeps) {
  const app = Fastify({
    logger,
    // Propagate a caller's request id (e.g. from a gateway) or generate one; it is echoed in errors and logs.
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && incoming.length <= 100 ? incoming : randomUUID();
    },
  });

  app.register(cors, {
    origin: corsOrigin ? corsOrigin.split(',').map((o) => o.trim()) : false,
    allowedHeaders: ['Content-Type', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['Idempotent-Replayed', 'X-Request-Id'],
  });

  app.addHook('onSend', async (req, reply) => {
    reply.header('X-Request-Id', req.id);
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      // Expected business outcomes (validation, conflicts): info, not error.
      req.log.info({ code: err.code }, err.message);
      return reply.code(err.statusCode).send(errorBody(err.code, err.message, req.id, err.details));
    }
    const fastifyErr = err as { statusCode?: number; code?: string; message?: string };
    if (fastifyErr.statusCode && fastifyErr.statusCode < 500) {
      // Framework-level client errors, e.g. malformed JSON or wrong content type.
      return reply
        .code(fastifyErr.statusCode)
        .send(errorBody('BAD_REQUEST', fastifyErr.message ?? 'Bad request', req.id));
    }
    // Unexpected: log the full error, return nothing internal to the client.
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send(errorBody('INTERNAL_ERROR', 'Something went wrong. Please try again.', req.id));
  });

  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send(errorBody('ROUTE_NOT_FOUND', `Route ${req.method} ${req.url} not found`, req.id));
  });

  app.get('/health', async (_req, reply) => {
    try {
      await pool.query('SELECT 1');
      return { status: 'ok', database: 'up' };
    } catch {
      return reply.code(503).send({ status: 'degraded', database: 'down' });
    }
  });

  app.register(async (api) => {
    rideRoutes(api, { pool });
    fareRoutes(api, { pool });
    driverRoutes(api, { pool });
  });

  return app;
}

function errorBody(code: string, message: string, requestId: string, details?: unknown) {
  return { error: { code, message, ...(details !== undefined && { details }), requestId } };
}
