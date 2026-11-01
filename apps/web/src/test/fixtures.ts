import type { FareEstimate, Ride } from '@/lib/types';

export const RIDER_ID = '00000000-0000-4000-8000-000000000001';

export const ESTIMATES: FareEstimate[] = [
  { category: 'ECONOMY', currency: 'PKR', estimatedFare: 410, distanceKm: 4.37, durationMin: 12, pickupEtaMin: 3, driversAvailable: true },
  { category: 'COMFORT', currency: 'PKR', estimatedFare: 630, distanceKm: 4.37, durationMin: 12, pickupEtaMin: null, driversAvailable: false },
];

export function makeRide(overrides: Partial<Ride> = {}): Ride {
  return {
    id: '20000000-0000-4000-8000-000000000001',
    riderId: RIDER_ID,
    category: 'ECONOMY',
    status: 'REQUESTED',
    pickup: { address: 'Liberty Market, Gulberg', lat: 31.5104, lng: 74.3416 },
    dropoff: { address: 'Model Town Park', lat: 31.4834, lng: 74.3256 },
    driver: null,
    fare: { currency: 'PKR', estimated: 410, final: null, distanceKm: 4.37, durationMin: 12 },
    pickupEtaMin: 3,
    cancellation: null,
    allowedActions: ['accept', 'cancel'],
    timestamps: { requestedAt: '2026-11-01T10:00:00.000Z', acceptedAt: null, completedAt: null, cancelledAt: null },
    ...overrides,
  };
}

/** A promise you resolve/reject by hand, to hold a component in its loading state. */
export function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
