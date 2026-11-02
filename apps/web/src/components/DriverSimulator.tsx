'use client';

import { useState } from 'react';
import { api, friendlyMessage } from '@/lib/api';
import { newIdempotencyKey } from '@/lib/format';
import type { Ride } from '@/lib/types';
import { ErrorMessage } from './ErrorMessage';

interface Props {
  ride: Ride;
  onRideChange: (ride: Ride) => void;
}

/**
 * Demo-only controls standing in for the driver app / dispatcher, so the full
 * lifecycle can be exercised from one screen. Not part of the rider UI.
 */
export function DriverSimulator({ ride, onRideChange }: Props) {
  const [busy, setBusy] = useState<'accept' | 'complete' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: 'accept' | 'complete') {
    setBusy(action);
    setError(null);
    try {
      const key = newIdempotencyKey();
      onRideChange(action === 'accept' ? await api.acceptRide(ride.id, key) : await api.completeRide(ride.id, key));
    } catch (err) {
      setError(friendlyMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (!ride.allowedActions.some((a) => a === 'accept' || a === 'complete')) return null;

  return (
    <aside className="card card-demo" aria-label="Driver simulator">
      <p className="demo-label">Demo controls: stand-in for the driver app</p>
      {error && <ErrorMessage message={error} />}
      <div className="demo-actions">
        {ride.allowedActions.includes('accept') && (
          <button type="button" className="btn btn-secondary" onClick={() => run('accept')} disabled={busy !== null}>
            {busy === 'accept' ? 'Assigning…' : 'Assign nearest driver'}
          </button>
        )}
        {ride.allowedActions.includes('complete') && (
          <button type="button" className="btn btn-secondary" onClick={() => run('complete')} disabled={busy !== null}>
            {busy === 'complete' ? 'Completing…' : 'Complete trip'}
          </button>
        )}
      </div>
    </aside>
  );
}
