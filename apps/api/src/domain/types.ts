export const RIDE_CATEGORIES = ['ECONOMY', 'COMFORT'] as const;
export type RideCategory = (typeof RIDE_CATEGORIES)[number];

export const RIDE_STATUSES = ['REQUESTED', 'ACCEPTED', 'COMPLETED', 'CANCELLED'] as const;
export type RideStatus = (typeof RIDE_STATUSES)[number];

export const DRIVER_STATUSES = ['OFFLINE', 'AVAILABLE', 'ON_TRIP'] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];

export const CANCEL_ACTORS = ['RIDER', 'DRIVER', 'SYSTEM'] as const;
export type CancelActor = (typeof CANCEL_ACTORS)[number];

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Place extends LatLng {
  address: string;
}
