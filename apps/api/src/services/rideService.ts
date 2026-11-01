import type { PoolClient } from 'pg';
import { calculateFare, estimateTrip, MAX_PICKUP_DISTANCE_KM, pickupEtaMinutes } from '../domain/fare';
import { assertTransition } from '../domain/rideStateMachine';
import type { CancelActor, Place, RideCategory } from '../domain/types';
import { AppError, Errors, uniqueViolation } from '../errors';
import * as drivers from '../repositories/driverRepository';
import { getFareRate } from '../repositories/fareRepository';
import type { Queryable } from '../repositories/queryable';
import * as rides from '../repositories/rideRepository';
import { riderExists } from '../repositories/riderRepository';
import { toRideDto, type RideDto } from './dto';

/*
 * Concurrency model
 * -----------------
 * Every state-changing operation runs in ONE transaction (the caller supplies
 * `tx`) and follows the same lock order: ride row first, then driver row.
 * A single global lock order means two transactions can never deadlock on
 * each other.
 *
 *  - Two accepts for the same ride: the second blocks on the ride lock, then
 *    sees status ACCEPTED and fails with INVALID_STATE_TRANSITION.
 *  - Two rides matching at once: `FOR UPDATE SKIP LOCKED` makes each pick a
 *    different driver.
 *  - Unique partial indexes (one active ride per rider / per driver) back all
 *    of this up at the database level.
 */

export interface CreateRideInput {
  riderId: string;
  category: RideCategory;
  pickup: Place;
  dropoff: Place;
}

export async function createRide(tx: PoolClient, input: CreateRideInput): Promise<RideDto> {
  if (!(await riderExists(tx, input.riderId))) throw Errors.notFound('Rider', input.riderId);

  const active = await rides.findActiveRideForRider(tx, input.riderId);
  if (active) throw Errors.activeRideExists(active.id);

  const rate = await getFareRate(tx, input.category);
  if (!rate) throw new AppError(500, 'FARE_RATE_MISSING', `No fare rate configured for ${input.category}`);

  const trip = estimateTrip(input.pickup, input.dropoff);
  const nearest = await drivers.findNearestAvailable(tx, input.category, input.pickup, MAX_PICKUP_DISTANCE_KM);

  let rideId: string;
  try {
    rideId = await rides.insertRide(tx, {
      ...input,
      distanceKm: trip.distanceKm,
      durationMin: trip.durationMin,
      estimatedFarePkr: calculateFare(rate, trip),
      pickupEtaMin: nearest ? pickupEtaMinutes(nearest, input.pickup) : null,
    });
  } catch (err) {
    // Lost a race with a concurrent request for the same rider.
    if (uniqueViolation(err) === 'rides_one_active_per_rider') throw Errors.activeRideExists();
    throw err;
  }

  await rides.insertRideEvent(tx, { rideId, fromStatus: null, toStatus: 'REQUESTED', actor: 'RIDER' });
  return loadRide(tx, rideId);
}

export async function getRide(q: Queryable, id: string): Promise<RideDto> {
  return loadRide(q, id);
}

export async function getActiveRideForRider(q: Queryable, riderId: string): Promise<RideDto | null> {
  const row = await rides.findActiveRideForRider(q, riderId);
  return row ? toRideDto(row) : null;
}

/**
 * Assigns a driver to a REQUESTED ride.
 *  - With `driverId`: that specific driver accepts (driver-app flow).
 *  - Without: the system picks the nearest eligible driver (dispatch flow).
 */
export async function acceptRide(tx: PoolClient, rideId: string, opts: { driverId?: string }): Promise<RideDto> {
  const ride = await rides.lockRideById(tx, rideId);
  if (!ride) throw Errors.notFound('Ride', rideId);
  assertTransition(ride.status, 'ACCEPTED');

  const pickup = { lat: ride.pickup_lat, lng: ride.pickup_lng };
  let driver: drivers.DriverRow | undefined;

  if (opts.driverId) {
    driver = await drivers.lockDriverById(tx, opts.driverId);
    if (!driver) throw Errors.notFound('Driver', opts.driverId);
    if (driver.status !== 'AVAILABLE') throw Errors.driverUnavailable(driver.id);
    if (driver.category !== ride.category) throw Errors.driverCategoryMismatch(driver.category, ride.category);
  } else {
    driver = await drivers.lockNearestAvailable(tx, ride.category, pickup, MAX_PICKUP_DISTANCE_KM);
    if (!driver) throw Errors.noDriversAvailable();
  }

  const eta = pickupEtaMinutes(driver, pickup);
  try {
    if (!(await rides.markAccepted(tx, ride.id, driver.id, eta))) throw Errors.invalidTransition(ride.status, 'ACCEPTED');
  } catch (err) {
    if (uniqueViolation(err) === 'rides_one_active_per_driver') throw Errors.driverUnavailable(driver.id);
    throw err;
  }
  await drivers.setDriverStatus(tx, driver.id, 'ON_TRIP');
  await rides.insertRideEvent(tx, {
    rideId: ride.id,
    fromStatus: ride.status,
    toStatus: 'ACCEPTED',
    driverId: driver.id,
    actor: opts.driverId ? 'DRIVER' : 'SYSTEM',
    metadata: { pickupEtaMin: eta },
  });
  return loadRide(tx, ride.id);
}

export async function cancelRide(
  tx: PoolClient,
  rideId: string,
  opts: { actor: CancelActor; reason?: string },
): Promise<RideDto> {
  const ride = await rides.lockRideById(tx, rideId);
  if (!ride) throw Errors.notFound('Ride', rideId);
  assertTransition(ride.status, 'CANCELLED');
  if (opts.actor === 'DRIVER' && !ride.driver_id) {
    throw new AppError(409, 'NO_DRIVER_ASSIGNED', 'A driver can only cancel a ride assigned to them');
  }

  if (!(await rides.markCancelled(tx, ride.id, ride.status, opts.actor, opts.reason ?? null))) {
    throw Errors.invalidTransition(ride.status, 'CANCELLED');
  }
  if (ride.driver_id) {
    // Release the driver back into the pool.
    await drivers.lockDriverById(tx, ride.driver_id);
    await drivers.setDriverStatus(tx, ride.driver_id, 'AVAILABLE');
  }
  await rides.insertRideEvent(tx, {
    rideId: ride.id,
    fromStatus: ride.status,
    toStatus: 'CANCELLED',
    driverId: ride.driver_id,
    actor: opts.actor,
    metadata: opts.reason ? { reason: opts.reason } : {},
  });
  return loadRide(tx, ride.id);
}

export async function completeRide(tx: PoolClient, rideId: string): Promise<RideDto> {
  const ride = await rides.lockRideById(tx, rideId);
  if (!ride) throw Errors.notFound('Ride', rideId);
  assertTransition(ride.status, 'COMPLETED');

  // No live trip tracking in this scope, so the final fare equals the quoted fare.
  const finalFare = ride.estimated_fare_pkr;
  if (!(await rides.markCompleted(tx, ride.id, finalFare))) throw Errors.invalidTransition(ride.status, 'COMPLETED');

  // The driver is now available at the drop-off point.
  await drivers.lockDriverById(tx, ride.driver_id!);
  await drivers.setDriverStatus(tx, ride.driver_id!, 'AVAILABLE', { lat: ride.dropoff_lat, lng: ride.dropoff_lng });
  await rides.insertRideEvent(tx, {
    rideId: ride.id,
    fromStatus: ride.status,
    toStatus: 'COMPLETED',
    driverId: ride.driver_id,
    actor: 'DRIVER',
    metadata: { finalFarePkr: finalFare },
  });
  return loadRide(tx, ride.id);
}

async function loadRide(q: Queryable, id: string): Promise<RideDto> {
  const row = await rides.findRideById(q, id);
  if (!row) throw Errors.notFound('Ride', id);
  return toRideDto(row);
}
