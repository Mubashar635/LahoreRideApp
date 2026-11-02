import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { estimateFares } from '../../services/fareService';
import * as s from '../schemas';

export function fareRoutes(app: FastifyInstance, { pool }: { pool: Pool }) {
  // POST (not GET) because the input is a nested object; it has no side effects.
  app.post('/fare-estimates', async (req) => {
    const { pickup, dropoff } = s.parse(s.fareEstimateBody, req.body);
    return { estimates: await estimateFares(pool, pickup, dropoff) };
  });
}
