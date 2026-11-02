import type { RideCategory, RideStatus } from './types';

export const formatPkr = (amount: number) => `Rs ${amount.toLocaleString('en-PK')}`;

export const formatMinutes = (min: number) => (min === 1 ? '1 min' : `${min} min`);

export const CATEGORY_LABEL: Record<RideCategory, { name: string; blurb: string }> = {
  ECONOMY: { name: 'Economy', blurb: 'Affordable everyday rides' },
  COMFORT: { name: 'Comfort', blurb: 'Newer cars, extra legroom' },
};

export const STATUS_LABEL: Record<RideStatus, string> = {
  REQUESTED: 'Finding your driver',
  ACCEPTED: 'Driver on the way',
  COMPLETED: 'Trip completed',
  CANCELLED: 'Ride cancelled',
};

/** A fresh key per user intent (one "Request ride" press), reused across that intent's retries. */
export const newIdempotencyKey = () => crypto.randomUUID();
