import type { FareRate } from '../domain/fare';
import type { RideCategory } from '../domain/types';
import type { Queryable } from './queryable';

interface FareRateRow {
  category: RideCategory;
  base_fare_pkr: number;
  per_km_pkr: number;
  per_min_pkr: number;
  minimum_fare_pkr: number;
}

export async function getFareRates(q: Queryable): Promise<Map<RideCategory, FareRate>> {
  const { rows } = await q.query<FareRateRow>('SELECT * FROM fare_rates');
  return new Map(
    rows.map((r) => [
      r.category,
      { baseFarePkr: r.base_fare_pkr, perKmPkr: r.per_km_pkr, perMinPkr: r.per_min_pkr, minimumFarePkr: r.minimum_fare_pkr },
    ]),
  );
}

export async function getFareRate(q: Queryable, category: RideCategory): Promise<FareRate | undefined> {
  return (await getFareRates(q)).get(category);
}
