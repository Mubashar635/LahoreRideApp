import { Errors } from '../errors';
import type { RideStatus } from './types';

/**
 * The single source of truth for ride lifecycle rules.
 *
 *   REQUESTED ──accept──▶ ACCEPTED ──complete──▶ COMPLETED
 *       │                    │
 *       └──────cancel────────┴──────▶ CANCELLED
 *
 * COMPLETED and CANCELLED are terminal.
 */
const TRANSITIONS: Readonly<Record<RideStatus, readonly RideStatus[]>> = {
  REQUESTED: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransition(from: RideStatus, to: RideStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: RideStatus, to: RideStatus): void {
  if (!canTransition(from, to)) throw Errors.invalidTransition(from, to);
}

export type RideAction = 'accept' | 'cancel' | 'complete';

const ACTION_TARGET: Record<RideAction, RideStatus> = {
  accept: 'ACCEPTED',
  cancel: 'CANCELLED',
  complete: 'COMPLETED',
};

/** Actions currently permitted for a ride; lets the UI show only valid buttons. */
export function allowedActions(status: RideStatus): RideAction[] {
  return (Object.keys(ACTION_TARGET) as RideAction[]).filter((a) => canTransition(status, ACTION_TARGET[a]));
}

export function isActive(status: RideStatus): boolean {
  return status === 'REQUESTED' || status === 'ACCEPTED';
}
