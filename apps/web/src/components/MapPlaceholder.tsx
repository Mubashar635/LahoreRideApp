import type { Place } from '@/lib/types';

// Same box the API uses as its service area.
const BOUNDS = { minLat: 31.4, maxLat: 31.62, minLng: 74.22, maxLng: 74.46 };
const W = 400;
const H = 300;

function project(p: { lat: number; lng: number }) {
  const x = ((p.lng - BOUNDS.minLng) / (BOUNDS.maxLng - BOUNDS.minLng)) * W;
  const y = H - ((p.lat - BOUNDS.minLat) / (BOUNDS.maxLat - BOUNDS.minLat)) * H;
  return { x: Math.min(W - 8, Math.max(8, x)), y: Math.min(H - 8, Math.max(8, y)) };
}

interface Props {
  pickup?: Place;
  dropoff?: Place;
}

/** Schematic map of Lahore. A real map (Mapbox / Google Maps) is optional per the brief. */
export function MapPlaceholder({ pickup, dropoff }: Props) {
  const a = pickup && project(pickup);
  const b = dropoff && project(dropoff);

  return (
    <figure className="map" aria-label="Trip map preview">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-hidden="true">
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" className="map-grid" />
          </pattern>
        </defs>
        <rect width={W} height={H} fill="url(#grid)" />
        {/* The Ravi river, roughly, for orientation */}
        <path d="M 40 0 C 90 60, 60 120, 0 170" className="map-river" />
        {a && b && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="map-route" />}
        {a && <circle cx={a.x} cy={a.y} r="8" className="map-pickup" />}
        {b && <rect x={b.x - 7} y={b.y - 7} width="14" height="14" className="map-dropoff" />}
      </svg>
      <figcaption>
        {pickup || dropoff ? (
          <>
            <span className="legend legend-pickup">Pickup</span>
            <span className="legend legend-dropoff">Destination</span>
          </>
        ) : (
          'Map preview: choose a pickup and destination'
        )}
      </figcaption>
    </figure>
  );
}
