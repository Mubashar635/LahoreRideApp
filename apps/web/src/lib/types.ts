// Mirrors the API's public JSON contract (see docs/openapi.yaml).

export type RideCategory = 'ECONOMY' | 'COMFORT';
export type RideStatus = 'REQUESTED' | 'ACCEPTED' | 'COMPLETED' | 'CANCELLED';
export type RideAction = 'accept' | 'cancel' | 'complete';

export interface Place {
  address: string;
  lat: number;
  lng: number;
}

export interface Ride {
  id: string;
  riderId: string;
  category: RideCategory;
  status: RideStatus;
  pickup: Place;
  dropoff: Place;
  driver: { id: string; name: string; phone: string; vehicleModel: string; vehiclePlate: string } | null;
  fare: { currency: 'PKR'; estimated: number; final: number | null; distanceKm: number; durationMin: number };
  pickupEtaMin: number | null;
  cancellation: { by: 'RIDER' | 'DRIVER' | 'SYSTEM'; reason: string | null } | null;
  allowedActions: RideAction[];
  timestamps: { requestedAt: string; acceptedAt: string | null; completedAt: string | null; cancelledAt: string | null };
}

export interface FareEstimate {
  category: RideCategory;
  currency: 'PKR';
  estimatedFare: number;
  distanceKm: number;
  durationMin: number;
  pickupEtaMin: number | null;
  driversAvailable: boolean;
}
