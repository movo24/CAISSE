/**
 * M307 — OccupancyService characterization (in-memory live store occupancy).
 *
 * Pure, ephemeral per-store counter (no DB). Locks the clamp/round on update,
 * the default for an unknown store, per-store isolation, and last-write-wins.
 */
import { OccupancyService } from '../src/modules/occupancy/occupancy.service';

describe('M307 — OccupancyService', () => {
  let svc: OccupancyService;
  const STORE_A = 'store-a';
  const STORE_B = 'store-b';

  beforeEach(() => {
    svc = new OccupancyService();
  });

  describe('updateOccupancy', () => {
    it('stores and returns the live count with a fresh timestamp', () => {
      const before = Date.now();
      const data = svc.updateOccupancy(STORE_A, 12);
      expect(data.liveCount).toBe(12);
      expect(data.lastUpdate).toBeInstanceOf(Date);
      expect(data.lastUpdate.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('clamps a negative count to 0', () => {
      expect(svc.updateOccupancy(STORE_A, -5).liveCount).toBe(0);
    });

    it('rounds a fractional count to the nearest integer', () => {
      expect(svc.updateOccupancy(STORE_A, 4.6).liveCount).toBe(5);
      expect(svc.updateOccupancy(STORE_A, 4.4).liveCount).toBe(4);
    });

    it('last write wins for the same store', () => {
      svc.updateOccupancy(STORE_A, 3);
      svc.updateOccupancy(STORE_A, 9);
      expect(svc.getLiveCount(STORE_A)).toBe(9);
    });
  });

  describe('getOccupancy', () => {
    it('returns a zeroed default at the epoch for an unknown store', () => {
      const data = svc.getOccupancy('never-seen');
      expect(data.liveCount).toBe(0);
      expect(data.lastUpdate.getTime()).toBe(0);
    });

    it('returns the stored value once set', () => {
      svc.updateOccupancy(STORE_A, 7);
      expect(svc.getOccupancy(STORE_A).liveCount).toBe(7);
    });
  });

  describe('per-store isolation', () => {
    it('keeps counts independent across stores', () => {
      svc.updateOccupancy(STORE_A, 4);
      svc.updateOccupancy(STORE_B, 11);
      expect(svc.getLiveCount(STORE_A)).toBe(4);
      expect(svc.getLiveCount(STORE_B)).toBe(11);
    });
  });

  describe('getLiveCount', () => {
    it('returns 0 for an unknown store', () => {
      expect(svc.getLiveCount('never-seen')).toBe(0);
    });
  });
});
