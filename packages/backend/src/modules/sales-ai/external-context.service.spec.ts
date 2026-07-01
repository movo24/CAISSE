import { ExternalContextService } from './external-context.service';

// PAQUET 269 — external context (weather / transport) fail-safe contract.
// The key honesty rule of STATE_INDEX: NO live data without a key. Without keys
// (or coords/station) the service must return a NEUTRAL, available:false context
// and never call the network. Pure branch coverage — no axios involved.

describe('ExternalContextService — fail-safe without keys', () => {
  const saved = {
    OPENWEATHER_API_KEY: process.env.OPENWEATHER_API_KEY,
    GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY,
    PRIM_API_KEY: process.env.PRIM_API_KEY,
  };

  beforeEach(() => {
    delete process.env.OPENWEATHER_API_KEY;
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.PRIM_API_KEY;
  });

  afterAll(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete (process.env as any)[k];
      else process.env[k] = v;
    }
  });

  it('getWeather returns a neutral, unavailable context when no key is set', async () => {
    const svc = new ExternalContextService();
    const w = await svc.getWeather(48.85, 2.35);
    expect(w.available).toBe(false);
    expect(w.impactScore).toBe(0);
  });

  it('getTransport returns a neutral, unavailable context when no key is set', async () => {
    const svc = new ExternalContextService();
    const t = await svc.getTransport('Chatelet');
    expect(t.available).toBe(false);
    expect(t.hasDisruptions).toBe(false);
    expect(t.impactScore).toBe(0);
  });

  it('getWeather stays neutral when coordinates are missing (even hypothetically keyed)', async () => {
    const svc = new ExternalContextService();
    const w = await svc.getWeather();
    expect(w.available).toBe(false);
  });

  it('getFullContext combines to overallImpact=neutral with both sources unavailable', async () => {
    const svc = new ExternalContextService();
    const ctx = await svc.getFullContext(48.85, 2.35, 'Chatelet');
    expect(ctx.weather.available).toBe(false);
    expect(ctx.transport.available).toBe(false);
    expect(ctx.overallImpact).toBe('neutral');
    expect(typeof ctx.fetchedAt).toBe('string');
  });
});
