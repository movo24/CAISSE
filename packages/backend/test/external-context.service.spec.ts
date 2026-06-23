import './helpers/env-setup';
import axios from 'axios';
import { ExternalContextService } from '../src/modules/sales-ai/external-context.service';

jest.mock('axios');
const mockedGet = axios.get as unknown as jest.Mock;

/**
 * ExternalContextService — pure no-DB service.
 * Constructor signature (verified from source): new ExternalContextService() — zero args.
 * Outbound HTTP (axios.get) is the only collaborator; it is fully mocked here so every
 * test path is deterministic. Private weather/transport caches start empty on each new
 * instance, so we construct a fresh service per test for isolation.
 */
describe('ExternalContextService', () => {
  let service: ExternalContextService;

  // Snapshot env keys the service reads so we can mutate freely and restore.
  const ENV_KEYS = ['OPENWEATHER_API_KEY', 'GOOGLE_MAPS_API_KEY', 'PRIM_API_KEY'];
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    jest.clearAllMocks();
    savedEnv = {};
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    service = new ExternalContextService();
    // Silence Logger.warn noise on the fail-safe paths.
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  // ───────────────────────── WEATHER — neutral defaults ─────────────────────────

  describe('getWeather neutral defaults', () => {
    it('returns neutral (available=false) when no API key is set, without calling axios', async () => {
      const w = await service.getWeather(48.85, 2.35);
      expect(w.available).toBe(false);
      expect(w.impactScore).toBe(0);
      expect(w.condition).toBe('unknown');
      expect(w.temperature).toBe(20);
      expect(mockedGet).not.toHaveBeenCalled();
    });

    it('returns neutral when API key present but coordinates are missing', async () => {
      process.env.OPENWEATHER_API_KEY = 'k';
      const w = await service.getWeather(undefined, undefined);
      expect(w.available).toBe(false);
      expect(mockedGet).not.toHaveBeenCalled();
    });

    it('returns neutral and does not throw when axios rejects (fail-safe)', async () => {
      process.env.OPENWEATHER_API_KEY = 'k';
      mockedGet.mockRejectedValueOnce(new Error('network down'));
      const w = await service.getWeather(48.85, 2.35);
      expect(w.available).toBe(false);
      expect(w.impactScore).toBe(0);
      expect(mockedGet).toHaveBeenCalledTimes(1);
    });
  });

  // ───────────────────────── WEATHER — impact scoring branches ─────────────────────────

  describe('getWeather impact scoring', () => {
    beforeEach(() => {
      process.env.OPENWEATHER_API_KEY = 'k';
    });

    const mkResp = (overrides: any) => ({
      data: {
        main: { temp: 20, feels_like: 20, humidity: 60, ...(overrides.main || {}) },
        weather: overrides.weather,
      },
    });

    it('scores rain negatively', async () => {
      mockedGet.mockResolvedValueOnce(
        mkResp({ main: { temp: 14 }, weather: [{ main: 'Rain', description: 'pluie légère' }] }),
      );
      const w = await service.getWeather(48.85, 2.35);
      expect(w.available).toBe(true);
      expect(w.condition).toBe('rain');
      expect(w.impactScore).toBe(-0.3);
      expect(w.impactReason).toContain('Pluie');
    });

    it('scores snow/storm strongly negative', async () => {
      mockedGet.mockResolvedValueOnce(
        mkResp({ main: { temp: 1 }, weather: [{ main: 'Snow', description: 'neige' }] }),
      );
      const w = await service.getWeather(48.85, 2.35);
      // condition 'snow' is matched before the temp<5 branch (order in source).
      expect(w.impactScore).toBe(-0.6);
      expect(w.impactReason).toContain('Intempéries');
    });

    it('scores hot weather (>30) positively for cold drinks', async () => {
      mockedGet.mockResolvedValueOnce(
        mkResp({ main: { temp: 33 }, weather: [{ main: 'Clear', description: 'ciel dégagé' }] }),
      );
      const w = await service.getWeather(48.85, 2.35);
      expect(w.impactScore).toBe(0.4);
      expect(w.impactReason).toContain('Chaleur');
    });

    it('scores cold weather (<5) slightly negative', async () => {
      mockedGet.mockResolvedValueOnce(
        mkResp({ main: { temp: 2 }, weather: [{ main: 'Clouds', description: 'nuageux' }] }),
      );
      const w = await service.getWeather(48.85, 2.35);
      expect(w.impactScore).toBe(-0.2);
      expect(w.impactReason).toContain('Froid');
    });

    it('scores clear mild weather (15<temp<28) positively', async () => {
      mockedGet.mockResolvedValueOnce(
        mkResp({ main: { temp: 22 }, weather: [{ main: 'Clear', description: 'ensoleillé' }] }),
      );
      const w = await service.getWeather(48.85, 2.35);
      expect(w.impactScore).toBe(0.3);
      expect(w.impactReason).toContain('Beau temps');
    });

    it('leaves impact neutral for clouds at moderate temp', async () => {
      mockedGet.mockResolvedValueOnce(
        mkResp({ main: { temp: 12 }, weather: [{ main: 'Clouds', description: 'nuageux' }] }),
      );
      const w = await service.getWeather(48.85, 2.35);
      expect(w.impactScore).toBe(0);
      expect(w.impactReason).toBe('Conditions normales');
    });

    it('rounds temperature and feelsLike, and maps humidity/condition', async () => {
      mockedGet.mockResolvedValueOnce(
        mkResp({
          main: { temp: 22.7, feels_like: 21.2, humidity: 71 },
          weather: [{ main: 'Clouds', description: 'partiellement nuageux' }],
        }),
      );
      const w = await service.getWeather(48.85, 2.35);
      expect(w.temperature).toBe(23);
      expect(w.feelsLike).toBe(21);
      expect(w.humidity).toBe(71);
      expect(w.condition).toBe('clouds');
      expect(w.description).toBe('partiellement nuageux');
    });
  });

  // ───────────────────────── WEATHER — caching ─────────────────────────

  describe('getWeather caching', () => {
    it('serves a second call from cache without re-calling axios', async () => {
      process.env.OPENWEATHER_API_KEY = 'k';
      mockedGet.mockResolvedValueOnce({
        data: {
          main: { temp: 33, feels_like: 33, humidity: 40 },
          weather: [{ main: 'Clear', description: 'chaud' }],
        },
      });
      const first = await service.getWeather(48.85, 2.35);
      expect(first.impactScore).toBe(0.4);
      expect(mockedGet).toHaveBeenCalledTimes(1);

      // Second call: cache fresh (TTL 15min) → no new axios call, same data.
      const second = await service.getWeather(48.85, 2.35);
      expect(mockedGet).toHaveBeenCalledTimes(1);
      expect(second.temperature).toBe(33);
      expect(second.impactScore).toBe(0.4);
    });
  });

  // ───────────────────────── TRANSPORT — neutral defaults ─────────────────────────

  describe('getTransport neutral defaults', () => {
    it('returns neutral when no PRIM key, echoing the station name', async () => {
      const t = await service.getTransport('Châtelet');
      expect(t.available).toBe(false);
      expect(t.stationName).toBe('Châtelet');
      expect(t.hasDisruptions).toBe(false);
      expect(t.disruptions).toEqual([]);
      expect(mockedGet).not.toHaveBeenCalled();
    });

    it('returns neutral when key present but station missing', async () => {
      process.env.PRIM_API_KEY = 'p';
      const t = await service.getTransport(undefined);
      expect(t.available).toBe(false);
      expect(t.stationName).toBe('unknown');
      expect(mockedGet).not.toHaveBeenCalled();
    });

    it('returns neutral and does not throw when axios rejects (fail-safe)', async () => {
      process.env.PRIM_API_KEY = 'p';
      mockedGet.mockRejectedValueOnce(new Error('prim down'));
      const t = await service.getTransport('Gare du Nord');
      expect(t.available).toBe(false);
      expect(t.impactScore).toBe(0);
      expect(mockedGet).toHaveBeenCalledTimes(1);
    });
  });

  // ───────────────────────── TRANSPORT — parsing + scoring ─────────────────────────

  describe('getTransport parsing and scoring', () => {
    beforeEach(() => {
      process.env.PRIM_API_KEY = 'p';
    });

    const mkMessage = (text: string, line = 'L1', severity = 'high') => ({
      InfoChannelRef: { value: line },
      InfoMessageVersion: [{ Content: { Severity: severity } }],
      Content: { Message: [{ MessageText: { value: text } }] },
    });

    const mkPrimResp = (messages: any[]) => ({
      data: {
        Siri: {
          ServiceDelivery: {
            GeneralMessageDelivery: [{ InfoMessage: messages }],
          },
        },
      },
    });

    it('parses disruptions and maps line/severity/message', async () => {
      mockedGet.mockResolvedValueOnce(
        mkPrimResp([mkMessage('Trafic interrompu', 'RER A', 'severe')]),
      );
      const t = await service.getTransport('Auber');
      expect(t.available).toBe(true);
      expect(t.stationName).toBe('Auber'); // success path echoes the requested station, not a default
      expect(t.hasDisruptions).toBe(true);
      expect(t.disruptions).toHaveLength(1);
      expect(t.disruptions[0]).toEqual({
        line: 'RER A',
        severity: 'severe',
        message: 'Trafic interrompu',
      });
      expect(t.estimatedDelay).toBe(10);
      expect(t.impactScore).toBe(0.1); // exactly 1 disruption → light tier
    });

    it('filters out messages lacking MessageText value', async () => {
      const empty = { InfoChannelRef: { value: 'L2' }, Content: { Message: [{ MessageText: {} }] } };
      mockedGet.mockResolvedValueOnce(
        mkPrimResp([empty, mkMessage('Retards', 'L3')]),
      );
      const t = await service.getTransport('Nation');
      expect(t.disruptions).toHaveLength(1);
      expect(t.disruptions[0].line).toBe('L3');
    });

    it('caps disruptions at 5 even when more are returned', async () => {
      const many = Array.from({ length: 9 }, (_, i) => mkMessage(`msg ${i}`, `L${i}`));
      mockedGet.mockResolvedValueOnce(mkPrimResp(many));
      const t = await service.getTransport('Opéra');
      expect(t.disruptions).toHaveLength(5);
      // >=3 disruptions → impulse-buying positive tier.
      expect(t.impactScore).toBe(0.4);
      expect(t.impactReason).toContain('perturbations');
    });

    it('scores >=3 disruptions as positive (impulse buying)', async () => {
      mockedGet.mockResolvedValueOnce(
        mkPrimResp([mkMessage('a'), mkMessage('b'), mkMessage('c')]),
      );
      const t = await service.getTransport('Bastille');
      expect(t.impactScore).toBe(0.4);
    });

    it('falls back line label to "Réseau" when InfoChannelRef missing', async () => {
      const noLine = {
        InfoMessageVersion: [{ Content: {} }], // no Severity → service falls back to 'unknown'
        Content: { Message: [{ MessageText: { value: 'info' } }] },
      };
      mockedGet.mockResolvedValueOnce(mkPrimResp([noLine]));
      const t = await service.getTransport('Lyon');
      expect(t.disruptions[0].line).toBe('Réseau');
      expect(t.disruptions[0].severity).toBe('unknown');
    });

    it('returns available=true with no disruptions and neutral impact when feed is empty', async () => {
      mockedGet.mockResolvedValueOnce(mkPrimResp([]));
      const t = await service.getTransport('Saint-Lazare');
      expect(t.available).toBe(true);
      expect(t.hasDisruptions).toBe(false);
      expect(t.estimatedDelay).toBe(0);
      expect(t.impactScore).toBe(0);
      expect(t.impactReason).toBe('Transport normal');
    });

    it('serves a second call from cache without re-calling axios', async () => {
      mockedGet.mockResolvedValueOnce(mkPrimResp([mkMessage('x')]));
      const first = await service.getTransport('Montparnasse');
      expect(first.impactScore).toBe(0.1);
      expect(mockedGet).toHaveBeenCalledTimes(1);
      const second = await service.getTransport('Montparnasse');
      expect(mockedGet).toHaveBeenCalledTimes(1);
      expect(second.impactScore).toBe(0.1);
    });
  });

  // ───────────────────────── COMBINED CONTEXT ─────────────────────────

  describe('getFullContext overallImpact', () => {
    it('is positive when combined impact > 0.2', async () => {
      process.env.OPENWEATHER_API_KEY = 'k';
      process.env.PRIM_API_KEY = 'p';
      // weather hot (+0.4), transport empty (0) → 0.4 > 0.2 → positive
      mockedGet.mockImplementation(async (url: string) => {
        if (url.includes('openweathermap')) {
          return {
            data: {
              main: { temp: 33, feels_like: 33, humidity: 40 },
              weather: [{ main: 'Clear', description: 'chaud' }],
            },
          };
        }
        return {
          data: {
            Siri: { ServiceDelivery: { GeneralMessageDelivery: [{ InfoMessage: [] }] } },
          },
        };
      });
      const ctx = await service.getFullContext(48.85, 2.35, 'Châtelet');
      expect(ctx.overallImpact).toBe('positive');
      expect(typeof ctx.fetchedAt).toBe('string');
      expect(ctx.weather.available).toBe(true);
      expect(ctx.transport.available).toBe(true);
    });

    it('is negative when combined impact < -0.2', async () => {
      process.env.OPENWEATHER_API_KEY = 'k';
      // weather snow (-0.6); no transport key → transport neutral (0) → -0.6 → negative
      mockedGet.mockResolvedValueOnce({
        data: {
          main: { temp: 0, feels_like: -2, humidity: 80 },
          weather: [{ main: 'Snow', description: 'neige' }],
        },
      });
      const ctx = await service.getFullContext(48.85, 2.35, 'Châtelet');
      expect(ctx.weather.impactScore).toBe(-0.6);
      expect(ctx.transport.available).toBe(false);
      expect(ctx.overallImpact).toBe('negative');
    });

    it('is neutral when combined impact is within [-0.2, 0.2]', async () => {
      // No keys at all → both neutral (0 + 0) → neutral
      const ctx = await service.getFullContext(48.85, 2.35, 'Châtelet');
      expect(ctx.weather.available).toBe(false);
      expect(ctx.transport.available).toBe(false);
      expect(ctx.overallImpact).toBe('neutral');
    });
  });
});
