import { describe, expect, it } from 'vitest';
import { calculateFare, estimateTrip, pickupEtaMinutes, type FareRate } from '../../src/domain/fare';
import { haversineKm, isInServiceArea } from '../../src/domain/geo';

const ECONOMY: FareRate = { baseFarePkr: 150, perKmPkr: 45, perMinPkr: 5, minimumFarePkr: 250 };
const LIBERTY = { lat: 31.5104, lng: 74.3416 };
const MODEL_TOWN = { lat: 31.4834, lng: 74.3256 };

describe('geo', () => {
  it('computes great-circle distance', () => {
    // Liberty Market → Model Town is ~3.4 km in a straight line.
    expect(haversineKm(LIBERTY, MODEL_TOWN)).toBeCloseTo(3.36, 1);
    expect(haversineKm(LIBERTY, LIBERTY)).toBe(0);
  });

  it('accepts Lahore and rejects places outside it', () => {
    expect(isInServiceArea(LIBERTY)).toBe(true);
    expect(isInServiceArea({ lat: 24.8607, lng: 67.0011 })).toBe(false); // Karachi
    expect(isInServiceArea({ lat: 33.6844, lng: 73.0479 })).toBe(false); // Islamabad
  });
});

describe('fare', () => {
  it('estimates road distance and duration from straight-line distance', () => {
    const trip = estimateTrip(LIBERTY, MODEL_TOWN);
    expect(trip.distanceKm).toBeCloseTo(4.37, 2); // 3.36 km × 1.3 road factor
    expect(trip.durationMin).toBe(12); // at 22 km/h, rounded up
  });

  it('applies base + per-km + per-minute, rounded to the nearest 10 PKR', () => {
    // 150 + 45×10 + 5×20 = 700
    expect(calculateFare(ECONOMY, { distanceKm: 10, durationMin: 20 })).toBe(700);
    // 150 + 45×4.37 + 5×12 = 406.65 → 410
    expect(calculateFare(ECONOMY, { distanceKm: 4.37, durationMin: 12 })).toBe(410);
  });

  it('never charges below the minimum fare', () => {
    expect(calculateFare(ECONOMY, { distanceKm: 0.5, durationMin: 2 })).toBe(250);
  });

  it('returns integer PKR (no floating point money)', () => {
    const fare = calculateFare(ECONOMY, { distanceKm: 3.333, durationMin: 7 });
    expect(Number.isInteger(fare)).toBe(true);
  });

  it('gives at least a 1 minute pickup ETA, growing with distance', () => {
    expect(pickupEtaMinutes(LIBERTY, LIBERTY)).toBe(1);
    expect(pickupEtaMinutes(MODEL_TOWN, LIBERTY)).toBeGreaterThan(pickupEtaMinutes(LIBERTY, LIBERTY));
  });
});
