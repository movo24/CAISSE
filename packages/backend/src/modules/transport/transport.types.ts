// ── transport/transport.types.ts ─────────────────────────────────
// Shared interfaces for the Transport Context module (PRIM API)
// Ile-de-France Mobilites — metro, RER, tram, bus
// ─────────────────────────────────────────────────────────────────

/** Type of transport line */
export type TransportMode = 'metro' | 'rer' | 'tram' | 'bus' | 'train' | 'other';

/** Overall traffic status */
export type TrafficStatus = 'normal' | 'perturbe' | 'interrompu';

/** Severity levels for disruptions */
export type DisruptionSeverity = 'info' | 'warning' | 'critical';

/** A single transport line serving a station */
export interface TransportLine {
  id: string;           // Navitia line ID (e.g., "line:IDFM:C01374")
  code: string;         // Short code (e.g., "4", "A", "T3a")
  name: string;         // Full name (e.g., "Metro 4")
  mode: TransportMode;
  color?: string;       // Hex color for display (e.g., "CF009E")
}

/** A nearby transit station/stop */
export interface NearbyStation {
  id: string;           // Navitia stop_area ID
  name: string;         // Station name (e.g., "Chatelet")
  distanceM: number;    // Distance from store in meters
  coord: { lat: number; lon: number };
  lines: TransportLine[];
  type: TransportMode;  // Dominant mode of the station
}

/** A single disruption affecting a line */
export interface TransportDisruption {
  id: string;           // Disruption ID from PRIM
  line: string;         // Line display name (e.g., "Metro 4")
  lineId: string;       // PRIM line ID for matching
  type: string;         // "travaux" | "incident" | "greve" | "maintenance" | "autre"
  severity: DisruptionSeverity;
  message: string;      // Human-readable description (FR)
  cause?: string;       // Cause category from Navitia
  startDate?: string;   // ISO datetime
  endDate?: string;     // ISO datetime
}

/** Full transport context for a store (cached 10 min) */
export interface TransportContext {
  station: NearbyStation;       // Primary (closest) station
  allStations: NearbyStation[]; // All nearby stations (up to 5)
  traffic_status: TrafficStatus;
  disruptions: TransportDisruption[];
  activeDisruptionCount: number;
  last_update: string;          // ISO datetime
}

/** Persisted station configuration for a store */
export interface StoreTransportConfig {
  storeId: string;
  stations: NearbyStation[];
  discoveredAt: string;         // ISO datetime
}
