import { z } from 'zod';
import { MIN_TRIP_DISTANCE_KM } from '../domain/fare';
import { haversineKm, isInServiceArea } from '../domain/geo';
import { CANCEL_ACTORS, DRIVER_STATUSES, RIDE_CATEGORIES } from '../domain/types';
import { Errors } from '../errors';

const coordinates = {
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
};

const place = z
  .object({ address: z.string().trim().min(1, 'Address is required').max(200), ...coordinates })
  .refine(isInServiceArea, { message: 'Location is outside the Lahore service area' });

/** Shared pickup/dropoff rules: both in Lahore and not the same spot. */
function withTripRules<T extends z.ZodType<{ pickup: z.infer<typeof place>; dropoff: z.infer<typeof place> }>>(schema: T) {
  return schema.refine((v) => haversineKm(v.pickup, v.dropoff) >= MIN_TRIP_DISTANCE_KM, {
    message: 'Pickup and destination are too close together',
    path: ['dropoff'],
  });
}

export const fareEstimateBody = withTripRules(z.object({ pickup: place, dropoff: place }));

export const createRideBody = withTripRules(
  z.object({
    riderId: z.uuid(),
    category: z.enum(RIDE_CATEGORIES),
    pickup: place,
    dropoff: place,
  }),
);

export const acceptRideBody = z.object({ driverId: z.uuid().optional() }).strict();

export const cancelRideBody = z
  .object({
    actor: z.enum(CANCEL_ACTORS).default('RIDER'),
    reason: z.string().trim().max(300).optional(),
  })
  .strict();

export const completeRideBody = z.object({}).strict();

export const idParams = z.object({ id: z.uuid() });

export const listDriversQuery = z.object({
  status: z.enum(DRIVER_STATUSES).optional(),
  category: z.enum(RIDE_CATEGORIES).optional(),
});

export const driverAvailabilityBody = z.object({ status: z.enum(['AVAILABLE', 'OFFLINE']) }).strict();

export const idempotencyKeyHeader = z.string().trim().min(1).max(255).optional();

/** Parses input or throws a 400 VALIDATION_ERROR listing every problem by field path. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw Errors.validation(
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}
