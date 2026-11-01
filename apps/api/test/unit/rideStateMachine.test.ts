import { describe, expect, it } from 'vitest';
import { allowedActions, assertTransition, canTransition } from '../../src/domain/rideStateMachine';
import { RIDE_STATUSES, type RideStatus } from '../../src/domain/types';
import { AppError } from '../../src/errors';

const VALID: Array<[RideStatus, RideStatus]> = [
  ['REQUESTED', 'ACCEPTED'],
  ['REQUESTED', 'CANCELLED'],
  ['ACCEPTED', 'COMPLETED'],
  ['ACCEPTED', 'CANCELLED'],
];

describe('ride state machine', () => {
  it.each(VALID)('allows %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  // Every pair not in VALID must be rejected — including self-transitions and leaving terminal states.
  const invalid = RIDE_STATUSES.flatMap((from) =>
    RIDE_STATUSES.filter((to) => !VALID.some(([f, t]) => f === from && t === to)).map((to) => [from, to] as const),
  );

  it.each(invalid)('rejects %s -> %s with INVALID_STATE_TRANSITION', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    try {
      assertTransition(from, to);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(409);
      expect((err as AppError).code).toBe('INVALID_STATE_TRANSITION');
    }
  });

  it('exposes the actions the UI may offer for each status', () => {
    expect(allowedActions('REQUESTED')).toEqual(['accept', 'cancel']);
    expect(allowedActions('ACCEPTED')).toEqual(['cancel', 'complete']);
    expect(allowedActions('COMPLETED')).toEqual([]);
    expect(allowedActions('CANCELLED')).toEqual([]);
  });
});
