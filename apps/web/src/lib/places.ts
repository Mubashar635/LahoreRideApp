import type { Place } from './types';

/**
 * Known Lahore locations. Stands in for a geocoding/autocomplete service
 * (e.g. Google Places), which is out of scope for this assessment.
 */
export const LAHORE_PLACES: readonly Place[] = [
  { address: 'Liberty Market, Gulberg', lat: 31.5104, lng: 74.3416 },
  { address: 'MM Alam Road, Gulberg', lat: 31.5164, lng: 74.3517 },
  { address: 'Model Town Park', lat: 31.4834, lng: 74.3256 },
  { address: 'Emporium Mall, Johar Town', lat: 31.4675, lng: 74.2659 },
  { address: 'DHA Phase 5, Y Block', lat: 31.4697, lng: 74.4089 },
  { address: 'Packages Mall, Walton Road', lat: 31.4713, lng: 74.3553 },
  { address: 'Allama Iqbal International Airport', lat: 31.5216, lng: 74.4036 },
  { address: 'Badshahi Mosque', lat: 31.5881, lng: 74.3107 },
  { address: 'Mall Road, Anarkali', lat: 31.5580, lng: 74.3290 },
  { address: 'Lahore Railway Station', lat: 31.5772, lng: 74.3367 },
  { address: 'University of the Punjab (New Campus)', lat: 31.4998, lng: 74.2984 },
  { address: 'Fortress Stadium, Cantt', lat: 31.5332, lng: 74.3657 },
];

export function findPlace(address: string): Place | undefined {
  const q = address.trim().toLowerCase();
  return LAHORE_PLACES.find((p) => p.address.toLowerCase() === q);
}
