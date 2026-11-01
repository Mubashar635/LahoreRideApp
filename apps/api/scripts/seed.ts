import { config } from '../src/config';
import { createPool, withTransaction } from '../src/db/pool';

// Fixed IDs so the seed is idempotent and the web app can use a known demo rider
// (there is no authentication in this assessment — see README "Known limitations").
export const DEMO_RIDER_ID = '00000000-0000-4000-8000-000000000001';

const riders = [
  { id: DEMO_RIDER_ID, name: 'Ayesha Khan', phone: '+923001234567' },
  { id: '00000000-0000-4000-8000-000000000002', name: 'Bilal Ahmed', phone: '+923211234567' },
];

// Fares in PKR. Illustrative numbers, not real platform pricing.
const fareRates = [
  { category: 'ECONOMY', base: 150, perKm: 45, perMin: 5, minimum: 250 },
  { category: 'COMFORT', base: 250, perKm: 65, perMin: 8, minimum: 400 },
];

// Drivers placed around well-known Lahore areas.
const drivers = [
  { id: '10000000-0000-4000-8000-000000000001', name: 'Usman Tariq', phone: '+923331000001', plate: 'LEA-1021', model: 'Suzuki Alto', category: 'ECONOMY', status: 'AVAILABLE', lat: 31.5104, lng: 74.3416 }, // Liberty Market
  { id: '10000000-0000-4000-8000-000000000002', name: 'Hamza Iqbal', phone: '+923331000002', plate: 'LEB-2213', model: 'Suzuki Cultus', category: 'ECONOMY', status: 'AVAILABLE', lat: 31.4834, lng: 74.3256 }, // Model Town
  { id: '10000000-0000-4000-8000-000000000003', name: 'Ali Raza', phone: '+923331000003', plate: 'LEC-3307', model: 'Suzuki WagonR', category: 'ECONOMY', status: 'AVAILABLE', lat: 31.4697, lng: 74.2728 }, // Johar Town
  { id: '10000000-0000-4000-8000-000000000004', name: 'Saad Malik', phone: '+923331000004', plate: 'LED-4410', model: 'Toyota Vitz', category: 'ECONOMY', status: 'OFFLINE', lat: 31.5580, lng: 74.3290 }, // Mall Road
  { id: '10000000-0000-4000-8000-000000000005', name: 'Fahad Butt', phone: '+923331000005', plate: 'LEE-5521', model: 'Toyota Corolla', category: 'COMFORT', status: 'AVAILABLE', lat: 31.4697, lng: 74.4089 }, // DHA Phase 5
  { id: '10000000-0000-4000-8000-000000000006', name: 'Imran Sheikh', phone: '+923331000006', plate: 'LEF-6634', model: 'Honda City', category: 'COMFORT', status: 'AVAILABLE', lat: 31.5204, lng: 74.3587 }, // Gulberg
  { id: '10000000-0000-4000-8000-000000000007', name: 'Zain Chaudhry', phone: '+923331000007', plate: 'LEG-7745', model: 'Honda Civic', category: 'COMFORT', status: 'OFFLINE', lat: 31.5497, lng: 74.3436 }, // Shadman
];

async function main() {
  const pool = createPool(config.DATABASE_URL);
  try {
    await withTransaction(pool, async (client) => {
      for (const r of fareRates) {
        await client.query(
          `INSERT INTO fare_rates (category, base_fare_pkr, per_km_pkr, per_min_pkr, minimum_fare_pkr)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (category) DO UPDATE SET
             base_fare_pkr = EXCLUDED.base_fare_pkr, per_km_pkr = EXCLUDED.per_km_pkr,
             per_min_pkr = EXCLUDED.per_min_pkr, minimum_fare_pkr = EXCLUDED.minimum_fare_pkr,
             updated_at = now()`,
          [r.category, r.base, r.perKm, r.perMin, r.minimum],
        );
      }
      for (const r of riders) {
        await client.query(
          'INSERT INTO riders (id, name, phone) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
          [r.id, r.name, r.phone],
        );
      }
      for (const d of drivers) {
        await client.query(
          `INSERT INTO drivers (id, name, phone, vehicle_plate, vehicle_model, category, status, lat, lng)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (id) DO NOTHING`,
          [d.id, d.name, d.phone, d.plate, d.model, d.category, d.status, d.lat, d.lng],
        );
      }
    });
    console.log(`Seeded ${fareRates.length} fare rates, ${riders.length} riders, ${drivers.length} drivers.`);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
