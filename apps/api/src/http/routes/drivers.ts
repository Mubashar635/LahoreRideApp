import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import * as driverService from '../../services/driverService';
import * as s from '../schemas';

export function driverRoutes(app: FastifyInstance, { pool }: { pool: Pool }) {
  app.get('/drivers', async (req) => {
    const filter = s.parse(s.listDriversQuery, req.query);
    return { drivers: await driverService.listDrivers(pool, filter) };
  });

  app.post('/drivers/:id/availability', async (req) => {
    const { id } = s.parse(s.idParams, req.params);
    const { status } = s.parse(s.driverAvailabilityBody, req.body);
    return driverService.setAvailability(pool, id, status);
  });
}
