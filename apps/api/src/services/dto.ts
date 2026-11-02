import { allowedActions, type RideAction } from '../domain/rideStateMachine';
import type { CancelActor, DriverStatus, Place, RideCategory, RideStatus } from '../domain/types';
import type { DriverRow } from '../repositories/driverRepository';
import type { RideWithDriverRow } from '../repositories/rideRepository';

/** Public JSON shape of a ride. Kept separate from the DB row so the schema can evolve independently. */
export interface RideDto {
  id: string;
  riderId: string;
  category: RideCategory;
  status: RideStatus;
  pickup: Place;
  dropoff: Place;
  driver: { id: string; name: string; phone: string; vehicleModel: string; vehiclePlate: string } | null;
  fare: { currency: 'PKR'; estimated: number; final: number | null; distanceKm: number; durationMin: number };
  pickupEtaMin: number | null;
  cancellation: { by: CancelActor; reason: string | null } | null;
  allowedActions: RideAction[];
  timestamps: { requestedAt: string; acceptedAt: string | null; completedAt: string | null; cancelledAt: string | null };
}

export interface DriverDto {
  id: string;
  name: string;
  category: RideCategory;
  status: DriverStatus;
  vehicleModel: string;
  vehiclePlate: string;
  location: { lat: number; lng: number };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toRideDto(r: RideWithDriverRow): RideDto {
  return {
    id: r.id,
    riderId: r.rider_id,
    category: r.category,
    status: r.status,
    pickup: { address: r.pickup_address, lat: r.pickup_lat, lng: r.pickup_lng },
    dropoff: { address: r.dropoff_address, lat: r.dropoff_lat, lng: r.dropoff_lng },
    driver: r.driver_id
      ? {
          id: r.driver_id,
          name: r.driver_name!,
          phone: r.driver_phone!,
          vehicleModel: r.driver_vehicle_model!,
          vehiclePlate: r.driver_vehicle_plate!,
        }
      : null,
    fare: {
      currency: 'PKR',
      estimated: r.estimated_fare_pkr,
      final: r.final_fare_pkr,
      distanceKm: r.distance_km,
      durationMin: r.duration_min,
    },
    pickupEtaMin: r.pickup_eta_min,
    cancellation: r.cancelled_by ? { by: r.cancelled_by, reason: r.cancel_reason } : null,
    allowedActions: allowedActions(r.status),
    timestamps: {
      requestedAt: r.requested_at.toISOString(),
      acceptedAt: iso(r.accepted_at),
      completedAt: iso(r.completed_at),
      cancelledAt: iso(r.cancelled_at),
    },
  };
}

export function toDriverDto(d: DriverRow): DriverDto {
  return {
    id: d.id,
    name: d.name,
    category: d.category,
    status: d.status,
    vehicleModel: d.vehicle_model,
    vehiclePlate: d.vehicle_plate,
    location: { lat: d.lat, lng: d.lng },
  };
}
