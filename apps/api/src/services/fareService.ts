import { calculateFare, estimateTrip, MAX_PICKUP_DISTANCE_KM, pickupEtaMinutes } from '../domain/fare';
import { RIDE_CATEGORIES, type LatLng, type RideCategory } from '../domain/types';
import { findNearestAvailable } from '../repositories/driverRepository';
import { getFareRates } from '../repositories/fareRepository';
import type { Queryable } from '../repositories/queryable';

export interface FareEstimate {
  category: RideCategory;
  currency: 'PKR';
  estimatedFare: number;
  distanceKm: number;
  durationMin: number;
  /** Minutes until the nearest available driver could arrive; null when none is nearby. */
  pickupEtaMin: number | null;
  driversAvailable: boolean;
}

/** Quotes every category for a trip, so the rider can compare before requesting. Read-only, no locks. */
export async function estimateFares(q: Queryable, pickup: LatLng, dropoff: LatLng): Promise<FareEstimate[]> {
  const rates = await getFareRates(q);
  const trip = estimateTrip(pickup, dropoff);

  return Promise.all(
    RIDE_CATEGORIES.filter((c) => rates.has(c)).map(async (category) => {
      const nearest = await findNearestAvailable(q, category, pickup, MAX_PICKUP_DISTANCE_KM);
      return {
        category,
        currency: 'PKR' as const,
        estimatedFare: calculateFare(rates.get(category)!, trip),
        distanceKm: trip.distanceKm,
        durationMin: trip.durationMin,
        pickupEtaMin: nearest ? pickupEtaMinutes(nearest, pickup) : null,
        driversAvailable: Boolean(nearest),
      };
    }),
  );
}
