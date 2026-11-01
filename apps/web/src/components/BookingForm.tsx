'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, friendlyMessage } from '@/lib/api';
import { CATEGORY_LABEL, formatMinutes, formatPkr, newIdempotencyKey } from '@/lib/format';
import { findPlace, LAHORE_PLACES } from '@/lib/places';
import type { FareEstimate, Place, Ride, RideCategory } from '@/lib/types';
import { ErrorMessage, Spinner } from './ErrorMessage';

type EstimateState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; estimates: FareEstimate[] }
  | { status: 'error'; message: string };

interface Props {
  riderId: string;
  onRideCreated: (ride: Ride) => void;
  /** The rider already has a ride in progress (e.g. booked in another tab). */
  onActiveRideFound: (rideId: string) => void;
  onPlacesChange?: (pickup?: Place, dropoff?: Place) => void;
}

export function BookingForm({ riderId, onRideCreated, onActiveRideFound, onPlacesChange }: Props) {
  const [pickupText, setPickupText] = useState('');
  const [dropoffText, setDropoffText] = useState('');
  const [category, setCategory] = useState<RideCategory>('ECONOMY');
  const [estimate, setEstimate] = useState<EstimateState>({ status: 'idle' });
  const [estimateAttempt, setEstimateAttempt] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // One key per booking intent: a retry after a network failure reuses it, so
  // the server can never create two rides from one press of the button.
  const idempotencyKey = useRef<string | null>(null);

  const pickup = findPlace(pickupText);
  const dropoff = findPlace(dropoffText);
  const samePlace = Boolean(pickup && dropoff && pickup.address === dropoff.address);
  const tripReady = Boolean(pickup && dropoff && !samePlace);

  useEffect(() => {
    onPlacesChange?.(pickup, dropoff);
    idempotencyKey.current = null; // trip changed → new intent
    setSubmitError(null);
  }, [pickup?.address, dropoff?.address, category]);

  useEffect(() => {
    if (!pickup || !dropoff || samePlace) {
      setEstimate({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setEstimate({ status: 'loading' });
    api.estimateFares(pickup, dropoff).then(
      (estimates) => !cancelled && setEstimate({ status: 'success', estimates }),
      (err) => !cancelled && setEstimate({ status: 'error', message: friendlyMessage(err) }),
    );
    return () => {
      cancelled = true; // ignore responses for a trip the user has already changed
    };
  }, [pickup?.address, dropoff?.address, estimateAttempt]);

  const selected = estimate.status === 'success' ? estimate.estimates.find((e) => e.category === category) : undefined;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!pickup || !dropoff || samePlace || submitting) return;

    idempotencyKey.current ??= newIdempotencyKey();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const ride = await api.createRide({ riderId, category, pickup, dropoff }, idempotencyKey.current);
      idempotencyKey.current = null;
      onRideCreated(ride);
    } catch (err) {
      const activeRideId = (err as ApiError)?.code === 'ACTIVE_RIDE_EXISTS' && ((err as ApiError).details as { activeRideId?: string })?.activeRideId;
      if (activeRideId) return onActiveRideFound(activeRideId);
      // Keep the key only if the outcome is unknown (network/5xx); a definite rejection is a new attempt next time.
      if (!(err instanceof ApiError && err.retryable)) idempotencyKey.current = null;
      setSubmitError(friendlyMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  function swap() {
    setPickupText(dropoffText);
    setDropoffText(pickupText);
  }

  return (
    <form className="card" onSubmit={handleSubmit} noValidate aria-busy={submitting}>
      <h2 className="card-title">Where to?</h2>

      <datalist id="lahore-places">
        {LAHORE_PLACES.map((p) => (
          <option key={p.address} value={p.address} />
        ))}
      </datalist>

      <div className="places">
        <PlaceInput id="pickup" label="Pickup" value={pickupText} onChange={setPickupText} valid={Boolean(pickup)} />
        <button type="button" className="btn btn-icon" onClick={swap} aria-label="Swap pickup and destination">
          ⇅
        </button>
        <PlaceInput id="dropoff" label="Destination" value={dropoffText} onChange={setDropoffText} valid={Boolean(dropoff)} />
      </div>
      {samePlace && <p className="field-error" role="alert">Pickup and destination must be different.</p>}

      <fieldset className="categories" disabled={!tripReady}>
        <legend>Ride type</legend>
        {estimate.status === 'idle' && <p className="muted">Choose a pickup and destination to see fares.</p>}
        {estimate.status === 'loading' && <Spinner label="Calculating fares…" />}
        {estimate.status === 'error' && (
          <ErrorMessage message={estimate.message} onRetry={() => setEstimateAttempt((n) => n + 1)} />
        )}
        {estimate.status === 'success' &&
          estimate.estimates.map((est) => (
            <label key={est.category} className={`category ${category === est.category ? 'selected' : ''}`}>
              <input
                type="radio"
                name="category"
                value={est.category}
                checked={category === est.category}
                onChange={() => setCategory(est.category)}
              />
              <span className="category-name">{CATEGORY_LABEL[est.category].name}</span>
              <span className="category-blurb">{CATEGORY_LABEL[est.category].blurb}</span>
              <span className="category-fare">{formatPkr(est.estimatedFare)}</span>
              <span className="category-eta">
                {est.driversAvailable && est.pickupEtaMin !== null
                  ? `Pickup in ${formatMinutes(est.pickupEtaMin)}`
                  : 'No drivers nearby'}
              </span>
            </label>
          ))}
      </fieldset>

      {selected && (
        <p className="trip-summary">
          {selected.distanceKm} km · about {formatMinutes(selected.durationMin)}
        </p>
      )}

      {submitError && <ErrorMessage message={submitError} />}

      <button type="submit" className="btn btn-primary btn-block" disabled={!tripReady || submitting}>
        {submitting
          ? 'Requesting…'
          : selected
            ? `Request ${CATEGORY_LABEL[category].name} · ${formatPkr(selected.estimatedFare)}`
            : 'Request ride'}
      </button>
    </form>
  );
}

function PlaceInput(props: { id: string; label: string; value: string; onChange: (v: string) => void; valid: boolean }) {
  const showError = props.value.trim().length > 0 && !props.valid;
  return (
    <div className="field">
      <label htmlFor={props.id}>{props.label}</label>
      <input
        id={props.id}
        list="lahore-places"
        autoComplete="off"
        placeholder="Search a place in Lahore"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        aria-invalid={showError}
        aria-describedby={showError ? `${props.id}-error` : undefined}
      />
      {showError && (
        <p id={`${props.id}-error`} className="field-error">
          Choose a place from the suggestions.
        </p>
      )}
    </div>
  );
}
