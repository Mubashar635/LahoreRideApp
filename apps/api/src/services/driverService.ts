import type { DriverStatus, RideCategory } from '../domain/types';
import { Errors } from '../errors';
import * as drivers from '../repositories/driverRepository';
import type { Queryable } from '../repositories/queryable';
import { toDriverDto, type DriverDto } from './dto';

export async function listDrivers(
  q: Queryable,
  filter: { status?: DriverStatus; category?: RideCategory },
): Promise<DriverDto[]> {
  return (await drivers.listDrivers(q, filter)).map(toDriverDto);
}

/** Driver goes online (AVAILABLE) or offline. Not allowed mid-trip. */
export async function setAvailability(q: Queryable, id: string, status: 'AVAILABLE' | 'OFFLINE'): Promise<DriverDto> {
  const updated = await drivers.setAvailability(q, id, status);
  if (updated) return toDriverDto(updated);

  const existing = await drivers.findDriverById(q, id);
  if (!existing) throw Errors.notFound('Driver', id);
  throw Errors.driverOnTrip(id);
}
