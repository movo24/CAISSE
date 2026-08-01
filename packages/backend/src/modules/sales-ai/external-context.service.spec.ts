import axios from 'axios';
import { ExternalContextService } from './external-context.service';

// PAQUET 269 + P365 — external context (weather / transport) fail-safe contract.
// The key honesty rule of STATE_INDEX: NO live data without a key. Without keys
// (or coords/station) the service must return a NEUTRAL, available:false context
// and never call the network. WITH a key, a mocked network response must map to
// available:true, and any network error must degrade back to neutral (never throw).

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

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
    mockedAxios.get.mockReset();
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
    expect(mockedAxios.get).not.toHaveBeenCalled(); // never hits the network without a key
  });

  it('getTransport returns a neutral, unavailable context when no key is set', async () => {
    const svc = new ExternalContextService();
    const t = await svc.getTransport('Chatelet');
    expect(t.available).toBe(false);
    expect(t.hasDisruptions).toBe(false);
    expect(t.impactScore).toBe(0);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('getWeather stays neutral when coordinates are missing (even hypothetically keyed)', async () => {
    process.env.OPENWEATHER_API_KEY = 'test-weather-key';
    const svc = new ExternalContextService();
    const w = await svc.getWeather();
    expect(w.available).toBe(false);
    expect(mockedAxios.get).not.toHaveBeenCalled();
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

describe('ExternalContextService — live path with a key (mocked network)', () => {
  const saved = {
    OPENWEATHER_API_KEY: process.env.OPENWEATHER_API_KEY,
    GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY,
    PRIM_API_KEY: process.env.PRIM_API_KEY,
  };

  beforeEach(() => {
    delete process.env.OPENWEATHER_API_KEY;
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.PRIM_API_KEY;
    mockedAxios.get.mockReset();
  });

  afterAll(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete (process.env as any)[k];
      else process.env[k] = v;
    }
  });

  it('getWeather maps a successful OpenWeather response to available:true (temp rounded)', async () => {
    process.env.OPENWEATHER_API_KEY = 'test-weather-key';
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        main: { temp: 12.4, feels_like: 10.2, humidity: 80 },
        weather: [{ main: 'Rain', description: 'pluie légère' }],
      },
    });

    const svc = new ExternalContextService();
    const w = await svc.getWeather(48.85, 2.35);

    expect(w.available).toBe(true);
    expect(w.temperature).toBe(12); // rounded from 12.4
    expect(w.condition).toBe('rain');
    expect(w.description).toBe('pluie légère');
    expect(typeof w.impactScore).toBe('number');
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it('GOOGLE_MAPS_API_KEY only serves as an OpenWeather appid fallback — no real Maps call', async () => {
    // Documents the wiring: a Google Maps key here is passed as the OpenWeather
    // `appid`, so a genuine Maps key would 401 → neutral. No Google endpoint is hit.
    process.env.GOOGLE_MAPS_API_KEY = 'gmaps-fallback-key';
    mockedAxios.get.mockResolvedValueOnce({
      data: { main: { temp: 21, feels_like: 21, humidity: 40 }, weather: [{ main: 'Clear', description: 'ciel dégagé' }] },
    });

    const svc = new ExternalContextService();
    await svc.getWeather(48.85, 2.35);

    const calledUrl = String(mockedAxios.get.mock.calls[0][0]);
    expect(calledUrl).toContain('openweathermap.org'); // OpenWeather endpoint, never a Google one
    expect(calledUrl).toContain('appid=gmaps-fallback-key'); // key injected as OpenWeather appid
  });

  it('getWeather degrades to neutral when the network throws (never propagates)', async () => {
    process.env.OPENWEATHER_API_KEY = 'test-weather-key';
    mockedAxios.get.mockRejectedValueOnce(new Error('ETIMEDOUT'));

    const svc = new ExternalContextService();
    const w = await svc.getWeather(48.85, 2.35);

    expect(w.available).toBe(false);
    expect(w.impactScore).toBe(0);
    expect(w.description).toContain('indisponibles');
  });

  it('getTransport parses PRIM disruptions into an impact score', async () => {
    process.env.PRIM_API_KEY = 'test-prim-key';
    const msg = (text: string) => ({
      InfoChannelRef: { value: 'RER A' },
      Content: { Message: [{ MessageText: { value: text } }] },
    });
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        Siri: {
          ServiceDelivery: {
            GeneralMessageDelivery: [{ InfoMessage: [msg('Trafic perturbé'), msg('Retards'), msg('Incident')] }],
          },
        },
      },
    });

    const svc = new ExternalContextService();
    const t = await svc.getTransport('Chatelet');

    expect(t.available).toBe(true);
    expect(t.hasDisruptions).toBe(true);
    expect(t.disruptions).toHaveLength(3);
    expect(t.impactScore).toBeGreaterThan(0); // ≥3 disruptions → positive impulse-buy impact
  });

  it('getTransport degrades to neutral when the network throws (never propagates)', async () => {
    process.env.PRIM_API_KEY = 'test-prim-key';
    mockedAxios.get.mockRejectedValueOnce(new Error('ECONNRESET'));

    const svc = new ExternalContextService();
    const t = await svc.getTransport('Chatelet');

    expect(t.available).toBe(false);
    expect(t.hasDisruptions).toBe(false);
  });
});
