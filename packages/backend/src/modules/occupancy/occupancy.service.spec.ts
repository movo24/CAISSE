import { OccupancyService } from './occupancy.service';

// PAQUET 254 — occupancy service (in-memory radar feed, no DB). Locks the
// clamping/rounding, the safe default for an unknown store, and the view
// composition (level + staleness delegated to pure helpers).

describe('OccupancyService', () => {
  let service: OccupancyService;
  beforeEach(() => {
    service = new OccupancyService();
  });

  it('clamps negative counts to 0 and rounds fractional counts', () => {
    expect(service.updateOccupancy('s1', -5).liveCount).toBe(0);
    expect(service.updateOccupancy('s1', 3.6).liveCount).toBe(4);
  });

  it('returns a safe default (0 count, epoch date) for an unknown store', () => {
    const d = service.getOccupancy('never-seen');
    expect(d.liveCount).toBe(0);
    expect(d.lastUpdate.getTime()).toBe(0);
  });

  it('getLiveCount reflects the last update', () => {
    service.updateOccupancy('s1', 12);
    expect(service.getLiveCount('s1')).toBe(12);
  });

  it('getView is fresh right after an update and stale for an unknown store', () => {
    service.updateOccupancy('s1', 8);
    const fresh = service.getView('s1', 100);
    expect(fresh.liveCount).toBe(8);
    expect(fresh.stale).toBe(false);
    expect(typeof fresh.level).toBe('string');

    const unknown = service.getView('ghost', 100);
    expect(unknown.liveCount).toBe(0);
    expect(unknown.stale).toBe(true);
  });

  it('reports an unknown level when no capacity is provided', () => {
    service.updateOccupancy('s1', 8);
    expect(service.getView('s1').level).toBe('unknown');
  });
});
