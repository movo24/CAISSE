// ── footfall/footfall.types.ts ───────────────────────────────────
// Types for footfall (foot traffic) estimation using Google Places
// ─────────────────────────────────────────────────────────────────

/** Traffic level bucket derived from score */
export type TrafficLevel = 'low' | 'medium' | 'high';

/** Category of a nearby place (business type) */
export type PlaceCategory =
  | 'restaurant'
  | 'cafe'
  | 'bar'
  | 'shop'
  | 'supermarket'
  | 'school'
  | 'hospital'
  | 'transport'
  | 'park'
  | 'gym'
  | 'entertainment'
  | 'office'
  | 'other';

/** A nearby place discovered via Google Places API */
export interface NearbyPlace {
  placeId: string;
  name: string;
  category: PlaceCategory;
  types: string[];
  distanceM: number;
  rating: number | null;
  userRatingsTotal: number;
  businessStatus: string;
  vicinity: string;
  coord: { lat: number; lon: number };
}

/** Aggregated footfall context for a store */
export interface FootfallContext {
  /** 0-100 score estimating foot traffic density */
  footfallScore: number;
  /** Bucketed traffic level */
  nearbyTrafficLevel: TrafficLevel;
  /** Total number of nearby places found */
  totalNearbyPlaces: number;
  /** Total user ratings across all nearby places (proxy for visitor volume) */
  totalUserRatings: number;
  /** Average rating of nearby places */
  averageRating: number;
  /** Category breakdown: how many places per category */
  categoryBreakdown: Record<PlaceCategory, number>;
  /** Top places by traffic (highest user_ratings_total) */
  topPlaces: NearbyPlace[];
  /** All discovered places */
  allPlaces: NearbyPlace[];
  /** When this data was last fetched */
  updatedAt: string;
  /** Search radius used (meters) */
  radiusM: number;
}

/** Persisted footfall config per store */
export interface StoreFootfallConfig {
  storeId: string;
  places: NearbyPlace[];
  radiusM: number;
  discoveredAt: string;
}

/** Cache entry with TTL */
export interface FootfallCacheEntry {
  data: FootfallContext;
  expiresAt: number;
}
