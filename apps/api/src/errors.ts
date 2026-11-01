/**
 * Every error the API returns has the same shape:
 *   { "error": { "code": "MACHINE_READABLE", "message": "Human readable", "details": ..., "requestId": "..." } }
 * Clients branch on `code`, never on `message`.
 */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  validation: (details: unknown, message = 'Request validation failed') =>
    new AppError(400, 'VALIDATION_ERROR', message, details),
  notFound: (resource: string, id: string) =>
    new AppError(404, `${resource.toUpperCase()}_NOT_FOUND`, `${resource} ${id} was not found`),
  invalidTransition: (from: string, to: string) =>
    new AppError(409, 'INVALID_STATE_TRANSITION', `Ride cannot move from ${from} to ${to}`, { from, to }),
  activeRideExists: (activeRideId?: string) =>
    new AppError(409, 'ACTIVE_RIDE_EXISTS', 'Rider already has an active ride', activeRideId ? { activeRideId } : undefined),
  noDriversAvailable: () =>
    new AppError(409, 'NO_DRIVERS_AVAILABLE', 'No eligible driver is available nearby. Please try again shortly.'),
  driverUnavailable: (driverId: string) =>
    new AppError(409, 'DRIVER_UNAVAILABLE', `Driver ${driverId} is not available`),
  driverCategoryMismatch: (driverCategory: string, rideCategory: string) =>
    new AppError(409, 'DRIVER_CATEGORY_MISMATCH', `Driver serves ${driverCategory}, ride requires ${rideCategory}`),
  driverOnTrip: (driverId: string) =>
    new AppError(409, 'DRIVER_ON_TRIP', `Driver ${driverId} is on a trip; availability cannot change until it ends`),
  idempotencyKeyRequired: () =>
    new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'The Idempotency-Key header is required for this request'),
  idempotencyKeyReused: () =>
    new AppError(422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used with a different request body'),
};

/** Postgres unique-violation helper: returns the violated constraint name, if any. */
export function uniqueViolation(err: unknown): string | undefined {
  const e = err as { code?: string; constraint?: string };
  return e?.code === '23505' ? e.constraint : undefined;
}
