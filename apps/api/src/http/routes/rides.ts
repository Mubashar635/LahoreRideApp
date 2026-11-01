import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { Errors } from '../../errors';
import * as rideService from '../../services/rideService';
import { runIdempotent, type IdempotentResult } from '../../services/idempotency';
import * as s from '../schemas';

export function rideRoutes(app: FastifyInstance, { pool }: { pool: Pool }) {
  app.post('/rides', async (req, reply) => {
    const body = s.parse(s.createRideBody, req.body);
    // Creating a ride is the request most likely to be double-submitted
    // (double tap, flaky mobile network), so the key is mandatory here.
    const key = idempotencyKey(req);
    if (!key) throw Errors.idempotencyKeyRequired();

    const result = await runIdempotent(pool, { scope: `POST /rides|rider:${body.riderId}`, key, body }, 201, (tx) =>
      rideService.createRide(tx, body),
    );
    return send(reply, result);
  });

  app.get('/rides/:id', async (req) => {
    const { id } = s.parse(s.idParams, req.params);
    return rideService.getRide(pool, id);
  });

  app.post('/rides/:id/accept', async (req, reply) => {
    const { id } = s.parse(s.idParams, req.params);
    const body = s.parse(s.acceptRideBody, req.body ?? {});
    const result = await runIdempotent(pool, { scope: `POST /rides/${id}/accept`, key: idempotencyKey(req), body }, 200, (tx) =>
      rideService.acceptRide(tx, id, body),
    );
    return send(reply, result);
  });

  app.post('/rides/:id/cancel', async (req, reply) => {
    const { id } = s.parse(s.idParams, req.params);
    const body = s.parse(s.cancelRideBody, req.body ?? {});
    const result = await runIdempotent(pool, { scope: `POST /rides/${id}/cancel`, key: idempotencyKey(req), body }, 200, (tx) =>
      rideService.cancelRide(tx, id, body),
    );
    return send(reply, result);
  });

  app.post('/rides/:id/complete', async (req, reply) => {
    const { id } = s.parse(s.idParams, req.params);
    const body = s.parse(s.completeRideBody, req.body ?? {});
    const result = await runIdempotent(pool, { scope: `POST /rides/${id}/complete`, key: idempotencyKey(req), body }, 200, (tx) =>
      rideService.completeRide(tx, id),
    );
    return send(reply, result);
  });

  // Lets the web app restore an in-progress ride after a page reload.
  app.get('/riders/:id/active-ride', async (req) => {
    const { id } = s.parse(s.idParams, req.params);
    return { ride: await rideService.getActiveRideForRider(pool, id) };
  });
}

function idempotencyKey(req: FastifyRequest): string | undefined {
  return s.parse(s.idempotencyKeyHeader, req.headers['idempotency-key']);
}

function send<T>(reply: FastifyReply, result: IdempotentResult<T>) {
  if (result.replayed) reply.header('Idempotent-Replayed', 'true');
  return reply.code(result.status).send(result.body);
}
