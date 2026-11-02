import type { CancelActor, Place, RideCategory, RideStatus } from '../domain/types';
import type { Queryable } from './queryable';

export interface RideRow {
  id: string;
  rider_id: string;
  category: RideCategory;
  status: RideStatus;
  pickup_address: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_address: string;
  dropoff_lat: number;
  dropoff_lng: number;
  driver_id: string | null;
  distance_km: number;
  duration_min: number;
  estimated_fare_pkr: number;
  final_fare_pkr: number | null;
  pickup_eta_min: number | null;
  cancelled_by: CancelActor | null;
  cancel_reason: string | null;
  requested_at: Date;
  accepted_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  updated_at: Date;
}

/** Ride joined with its assigned driver (if any), for API responses. */
export interface RideWithDriverRow extends RideRow {
  driver_name: string | null;
  driver_phone: string | null;
  driver_vehicle_model: string | null;
  driver_vehicle_plate: string | null;
}

const SELECT_WITH_DRIVER = `
  SELECT r.*,
         d.name          AS driver_name,
         d.phone         AS driver_phone,
         d.vehicle_model AS driver_vehicle_model,
         d.vehicle_plate AS driver_vehicle_plate
  FROM rides r
  LEFT JOIN drivers d ON d.id = r.driver_id`;

export async function findRideById(q: Queryable, id: string): Promise<RideWithDriverRow | undefined> {
  const { rows } = await q.query<RideWithDriverRow>(`${SELECT_WITH_DRIVER} WHERE r.id = $1`, [id]);
  return rows[0];
}

export async function findActiveRideForRider(q: Queryable, riderId: string): Promise<RideWithDriverRow | undefined> {
  const { rows } = await q.query<RideWithDriverRow>(
    `${SELECT_WITH_DRIVER} WHERE r.rider_id = $1 AND r.status IN ('REQUESTED', 'ACCEPTED')`,
    [riderId],
  );
  return rows[0];
}

/** Locks the ride row for the rest of the transaction; concurrent transitions on the same ride queue up here. */
export async function lockRideById(q: Queryable, id: string): Promise<RideRow | undefined> {
  const { rows } = await q.query<RideRow>('SELECT * FROM rides WHERE id = $1 FOR UPDATE', [id]);
  return rows[0];
}

export interface NewRide {
  riderId: string;
  category: RideCategory;
  pickup: Place;
  dropoff: Place;
  distanceKm: number;
  durationMin: number;
  estimatedFarePkr: number;
  pickupEtaMin: number | null;
}

export async function insertRide(q: Queryable, ride: NewRide): Promise<string> {
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO rides (rider_id, category, pickup_address, pickup_lat, pickup_lng,
                        dropoff_address, dropoff_lat, dropoff_lng,
                        distance_km, duration_min, estimated_fare_pkr, pickup_eta_min)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id`,
    [
      ride.riderId, ride.category,
      ride.pickup.address, ride.pickup.lat, ride.pickup.lng,
      ride.dropoff.address, ride.dropoff.lat, ride.dropoff.lng,
      ride.distanceKm, ride.durationMin, ride.estimatedFarePkr, ride.pickupEtaMin,
    ],
  );
  return rows[0]!.id;
}

// The transition updates below repeat the expected current status in the WHERE
// clause (compare-and-set). The row is already locked by the caller, so this is
// defence in depth: a transition can never apply to a ride in the wrong state.

export async function markAccepted(q: Queryable, id: string, driverId: string, pickupEtaMin: number): Promise<boolean> {
  const { rowCount } = await q.query(
    `UPDATE rides SET status = 'ACCEPTED', driver_id = $2, pickup_eta_min = $3, accepted_at = now(), updated_at = now()
     WHERE id = $1 AND status = 'REQUESTED'`,
    [id, driverId, pickupEtaMin],
  );
  return rowCount === 1;
}

export async function markCompleted(q: Queryable, id: string, finalFarePkr: number): Promise<boolean> {
  const { rowCount } = await q.query(
    `UPDATE rides SET status = 'COMPLETED', final_fare_pkr = $2, completed_at = now(), updated_at = now()
     WHERE id = $1 AND status = 'ACCEPTED'`,
    [id, finalFarePkr],
  );
  return rowCount === 1;
}

export async function markCancelled(
  q: Queryable,
  id: string,
  from: RideStatus,
  actor: CancelActor,
  reason: string | null,
): Promise<boolean> {
  const { rowCount } = await q.query(
    `UPDATE rides SET status = 'CANCELLED', cancelled_by = $3, cancel_reason = $4, cancelled_at = now(), updated_at = now()
     WHERE id = $1 AND status = $2`,
    [id, from, actor, reason],
  );
  return rowCount === 1;
}

export interface RideEvent {
  rideId: string;
  fromStatus: RideStatus | null;
  toStatus: RideStatus;
  driverId?: string | null;
  actor: string;
  metadata?: Record<string, unknown>;
}

export async function insertRideEvent(q: Queryable, e: RideEvent): Promise<void> {
  await q.query(
    `INSERT INTO ride_events (ride_id, from_status, to_status, driver_id, actor, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [e.rideId, e.fromStatus, e.toStatus, e.driverId ?? null, e.actor, JSON.stringify(e.metadata ?? {})],
  );
}
