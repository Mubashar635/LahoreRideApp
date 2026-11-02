import type { LatLng } from './types';

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance in km. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/**
 * Service area: a bounding box around Lahore. A real system would use a
 * polygon per city (and a `cities` table) — see ARCHITECTURE.md.
 */
export const LAHORE_BOUNDS = { minLat: 31.2, maxLat: 31.75, minLng: 74.0, maxLng: 74.6 } as const;

export function isInServiceArea({ lat, lng }: LatLng): boolean {
  return (
    lat >= LAHORE_BOUNDS.minLat && lat <= LAHORE_BOUNDS.maxLat && lng >= LAHORE_BOUNDS.minLng && lng <= LAHORE_BOUNDS.maxLng
  );
}
