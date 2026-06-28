/**
 * POS — Occupancy level classification (pure, unit-testable).
 * Maps a live head-count + capacity to a level, and flags stale feeds.
 * Ratio thresholds are DEFAULTS (operational, tunable): low<0.4, medium<0.7, high<1, else full.
 */
export type OccupancyLevel = 'empty' | 'low' | 'medium' | 'high' | 'full' | 'unknown';

export function occupancyLevel(
  liveCount: number,
  capacity: number | null | undefined,
  opts: { lowMax?: number; mediumMax?: number; highMax?: number } = {},
): OccupancyLevel {
  if (liveCount <= 0) return 'empty';
  if (!capacity || capacity <= 0) return 'unknown';
  const lowMax = opts.lowMax ?? 0.4;
  const mediumMax = opts.mediumMax ?? 0.7;
  const highMax = opts.highMax ?? 1;
  const ratio = liveCount / capacity;
  if (ratio < lowMax) return 'low';
  if (ratio < mediumMax) return 'medium';
  if (ratio < highMax) return 'high';
  return 'full';
}

/** True when the occupancy feed is older than `maxAgeMs` (default 5 min). */
export function isOccupancyStale(
  lastUpdate: Date | string,
  maxAgeMs = 5 * 60 * 1000,
  now: Date = new Date(),
): boolean {
  return now.getTime() - new Date(lastUpdate).getTime() > maxAgeMs;
}
