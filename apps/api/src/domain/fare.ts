import { haversineKm } from './geo';
import type { LatLng } from './types';

/**
 * Without a routing engine we approximate road distance and travel time:
 * straight-line distance × a road factor, at an average city speed.
 * Production would call a routing service (OSRM / Google Directions).
 */
export const ROAD_FACTOR = 1.3;
export const AVG_CITY_SPEED_KMH = 22;
/** Drivers further than this from the pickup are not eligible. */
export const MAX_PICKUP_DISTANCE_KM = 10;
/** Pickup and destination closer than this are rejected as invalid. */
export const MIN_TRIP_DISTANCE_KM = 0.3;

export interface FareRate {
  baseFarePkr: number;
  perKmPkr: number;
  perMinPkr: number;
  minimumFarePkr: number;
}

export interface TripEstimate {
  distanceKm: number;
  durationMin: number;
}

export function estimateTrip(pickup: LatLng, dropoff: LatLng): TripEstimate {
  const distanceKm = Math.round(haversineKm(pickup, dropoff) * ROAD_FACTOR * 100) / 100;
  return { distanceKm, durationMin: travelMinutes(distanceKm) };
}

/** Fare in whole PKR, rounded to the nearest 10 (cash friendly), never below the minimum. */
export function calculateFare(rate: FareRate, trip: TripEstimate): number {
  const raw = rate.baseFarePkr + rate.perKmPkr * trip.distanceKm + rate.perMinPkr * trip.durationMin;
  return Math.max(rate.minimumFarePkr, Math.round(raw / 10) * 10);
}

/** Minutes for a driver at `driver` to reach `pickup`. */
export function pickupEtaMinutes(driver: LatLng, pickup: LatLng): number {
  return travelMinutes(haversineKm(driver, pickup) * ROAD_FACTOR);
}

function travelMinutes(distanceKm: number): number {
  return Math.max(1, Math.ceil((distanceKm / AVG_CITY_SPEED_KMH) * 60));
}
