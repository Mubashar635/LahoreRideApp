'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, friendlyMessage } from '@/lib/api';
import type { Place, Ride } from '@/lib/types';
import { BookingForm } from './BookingForm';
import { DriverSimulator } from './DriverSimulator';
import { ErrorMessage, Spinner } from './ErrorMessage';
import { MapPlaceholder } from './MapPlaceholder';
import { RideTracker } from './RideTracker';

type View =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'booking' }
  | { kind: 'tracking'; ride: Ride };

export function RideApp({ riderId }: { riderId: string }) {
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [draft, setDraft] = useState<{ pickup?: Place; dropoff?: Place }>({});

  // On load (and on reload), resume any ride already in progress.
  const restore = useCallback(async () => {
    setView({ kind: 'loading' });
    try {
      const ride = await api.getActiveRide(riderId);
      setView(ride ? { kind: 'tracking', ride } : { kind: 'booking' });
    } catch (err) {
      setView({ kind: 'error', message: friendlyMessage(err) });
    }
  }, [riderId]);

  useEffect(() => {
    void restore();
  }, [restore]);

  const showRide = useCallback((ride: Ride) => setView({ kind: 'tracking', ride }), []);

  const openRide = useCallback(async (rideId: string) => {
    try {
      showRide(await api.getRide(rideId));
    } catch (err) {
      setView({ kind: 'error', message: friendlyMessage(err) });
    }
  }, [showRide]);

  const mapPlaces = view.kind === 'tracking' ? { pickup: view.ride.pickup, dropoff: view.ride.dropoff } : draft;

  return (
    <div className="layout">
      <MapPlaceholder pickup={mapPlaces.pickup} dropoff={mapPlaces.dropoff} />
      <div className="panel">
        {view.kind === 'loading' && (
          <div className="card card-center">
            <Spinner label="Loading…" />
          </div>
        )}
        {view.kind === 'error' && (
          <div className="card">
            <ErrorMessage message={view.message} onRetry={restore} />
          </div>
        )}
        {view.kind === 'booking' && (
          <BookingForm
            riderId={riderId}
            onRideCreated={showRide}
            onActiveRideFound={openRide}
            onPlacesChange={(pickup, dropoff) => setDraft({ pickup, dropoff })}
          />
        )}
        {view.kind === 'tracking' && (
          <>
            <RideTracker
              ride={view.ride}
              onRideChange={showRide}
              onBookAnother={() => {
                setDraft({});
                setView({ kind: 'booking' });
              }}
            />
            <DriverSimulator ride={view.ride} onRideChange={showRide} />
          </>
        )}
      </div>
    </div>
  );
}
