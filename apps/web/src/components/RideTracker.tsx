'use client';

import { useEffect, useRef, useState } from 'react';
import { api, ApiError, friendlyMessage } from '@/lib/api';
import { CATEGORY_LABEL, formatMinutes, formatPkr, newIdempotencyKey, STATUS_LABEL } from '@/lib/format';
import type { Ride } from '@/lib/types';
import { ErrorMessage } from './ErrorMessage';

const POLL_MS = 3000;

interface Props {
  ride: Ride;
  onRideChange: (ride: Ride) => void;
  onBookAnother: () => void;
}

export function RideTracker({ ride, onRideChange, onBookAnother }: Props) {
  const [pollError, setPollError] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const cancelKey = useRef<string | null>(null);
  const active = ride.status === 'REQUESTED' || ride.status === 'ACCEPTED';

  // Poll for updates while the ride is active. On failure keep showing the
  // last known state and a non-blocking warning; recover silently when back.
  useEffect(() => {
    if (!active) return;
    let inFlight = false;
    const timer = setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        onRideChange(await api.getRide(ride.id));
        setPollError(false);
      } catch {
        setPollError(true);
      } finally {
        inFlight = false;
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [active, ride.id, onRideChange]);

  async function cancel() {
    cancelKey.current ??= newIdempotencyKey();
    setCancelling(true);
    setActionError(null);
    try {
      onRideChange(await api.cancelRide(ride.id, cancelKey.current));
      cancelKey.current = null;
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INVALID_STATE_TRANSITION') {
        // The ride moved on (e.g. completed) before our cancel landed; show the truth.
        cancelKey.current = null;
        onRideChange(await api.getRide(ride.id).catch(() => ride));
      }
      setActionError(friendlyMessage(err));
    } finally {
      setCancelling(false);
    }
  }

  return (
    <section className="card" aria-labelledby="ride-status-title">
      <p className={`status-pill status-${ride.status.toLowerCase()}`}>{CATEGORY_LABEL[ride.category].name}</p>
      <h2 id="ride-status-title" className="card-title" aria-live="polite">
        {STATUS_LABEL[ride.status]}
      </h2>

      <Steps ride={ride} />

      {pollError && (
        <div className="alert alert-warning" role="status">
          Connection lost. Showing the last known status, retrying…
        </div>
      )}

      {ride.status === 'REQUESTED' && (
        <p className="muted">
          {ride.pickupEtaMin !== null
            ? `Nearest driver is about ${formatMinutes(ride.pickupEtaMin)} away.`
            : 'No drivers nearby yet. We will keep looking.'}
        </p>
      )}

      {ride.driver && ride.status !== 'CANCELLED' && (
        <div className="driver">
          <div className="driver-avatar" aria-hidden="true">{ride.driver.name.charAt(0)}</div>
          <div>
            <p className="driver-name">{ride.driver.name}</p>
            <p className="muted">
              {ride.driver.vehicleModel} · <span className="plate">{ride.driver.vehiclePlate}</span>
            </p>
          </div>
          {ride.status === 'ACCEPTED' && ride.pickupEtaMin !== null && (
            <p className="driver-eta">{formatMinutes(ride.pickupEtaMin)}</p>
          )}
        </div>
      )}

      <dl className="trip">
        <div>
          <dt>Pickup</dt>
          <dd>{ride.pickup.address}</dd>
        </div>
        <div>
          <dt>Destination</dt>
          <dd>{ride.dropoff.address}</dd>
        </div>
        <div>
          <dt>{ride.fare.final !== null ? 'Fare paid' : 'Estimated fare'}</dt>
          <dd className="fare">{formatPkr(ride.fare.final ?? ride.fare.estimated)}</dd>
        </div>
      </dl>

      {ride.status === 'CANCELLED' && ride.cancellation && (
        <p className="muted">
          Cancelled by {ride.cancellation.by.toLowerCase()}
          {ride.cancellation.reason ? `: ${ride.cancellation.reason}` : '.'}
        </p>
      )}

      {actionError && <ErrorMessage message={actionError} />}

      {ride.allowedActions.includes('cancel') && (
        <button type="button" className="btn btn-danger btn-block" onClick={cancel} disabled={cancelling}>
          {cancelling ? 'Cancelling…' : 'Cancel ride'}
        </button>
      )}
      {!active && (
        <button type="button" className="btn btn-primary btn-block" onClick={onBookAnother}>
          Book another ride
        </button>
      )}
    </section>
  );
}

function Steps({ ride }: { ride: Ride }) {
  const steps = [
    { label: 'Requested', done: true },
    { label: 'Driver assigned', done: Boolean(ride.timestamps.acceptedAt) },
    { label: 'Completed', done: ride.status === 'COMPLETED' },
  ];
  if (ride.status === 'CANCELLED') return null;
  return (
    <ol className="steps">
      {steps.map((s) => (
        <li key={s.label} className={s.done ? 'done' : ''}>
          {s.label}
        </li>
      ))}
    </ol>
  );
}
