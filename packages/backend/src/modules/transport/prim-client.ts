// ── transport/prim-client.ts ─────────────────────────────────────
// Low-level PRIM API client (Ile-de-France Mobilites)
// Uses native fetch, handles auth + timeouts + rate limiting
// ─────────────────────────────────────────────────────────────────

import { Injectable, Logger } from '@nestjs/common';
import { CircuitBreaker } from '../../common/resilience/circuit-breaker';

// ── Configuration ──
export const PRIM_CONFIG = {
  get apiKey(): string {
    return process.env.PRIM_API_KEY || '';
  },
  get isAvailable(): boolean {
    return PRIM_CONFIG.apiKey.length > 0;
  },
  baseUrl: 'https://prim.iledefrance-mobilites.fr/marketplace',
  requestTimeoutMs: 8_000,
  maxDailyRequests: 900, // safety margin (PRIM quota ~1000/day for SIRI)
};

@Injectable()
export class PrimClient {
  private readonly logger = new Logger('Transport:PRIM');
  private dailyRequestCount = 0;
  private lastResetDate = '';

  private readonly circuitBreaker = new CircuitBreaker('PRIM', {
    failureThreshold: 3,
    cooldownMs: 60_000,
    timeoutMs: 10_000,
    retryAttempts: 2,
    retryDelayMs: 1_500,
  });

  /**
   * Fetch nearby stop areas from PRIM/Navitia.
   * Uses the `places_nearby` endpoint with stop_area filter.
   */
  async fetchNearbyStops(
    lat: number,
    lon: number,
    radiusM = 500,
    count = 5,
  ): Promise<any> {
    // Navitia uses lon;lat format (reversed!)
    const url =
      `${PRIM_CONFIG.baseUrl}/navitia/coverage/fr-idf/coord/` +
      `${lon};${lat}/places_nearby` +
      `?type[]=stop_area&distance=${radiusM}&count=${count}`;

    return this.circuitBreaker.execute(
      () => this.request(url),
      () => ({ places_nearby: [] }),
    );
  }

  /**
   * Fetch line reports (disruptions) for specific lines.
   * If no lineIds provided, fetches all disruptions (heavy!).
   */
  async fetchLineReports(lineIds?: string[]): Promise<any> {
    if (lineIds && lineIds.length > 0) {
      // Fetch per-line reports and merge disruptions
      const allDisruptions: any[] = [];
      const seen = new Set<string>();

      for (const lineId of lineIds) {
        try {
          const url =
            `${PRIM_CONFIG.baseUrl}/navitia/coverage/fr-idf/` +
            `lines/${lineId}/line_reports`;
          const data = await this.request(url);

          // Collect disruptions, deduplicate by ID
          const disruptions = data?.disruptions || [];
          for (const d of disruptions) {
            if (d.id && !seen.has(d.id)) {
              seen.add(d.id);
              allDisruptions.push(d);
            }
          }
        } catch (err: any) {
          this.logger.debug(`Line report failed for ${lineId}: ${err.message}`);
          // Continue with other lines
        }
      }

      return { disruptions: allDisruptions };
    }

    // Fallback: fetch all line reports (costly, avoid in production)
    const url = `${PRIM_CONFIG.baseUrl}/navitia/coverage/fr-idf/line_reports`;
    return this.request(url);
  }

  /** Is the PRIM API configured and available? */
  isAvailable(): boolean {
    return PRIM_CONFIG.isAvailable;
  }

  // ═══════════════════════════════════════════════════════════════
  //  PRIVATE — HTTP request with auth, timeout, quota tracking
  // ═══════════════════════════════════════════════════════════════

  private async request(url: string): Promise<any> {
    if (!PRIM_CONFIG.isAvailable) {
      throw new Error('PRIM_API_KEY not configured');
    }

    // Reset daily counter at midnight
    const today = new Date().toISOString().split('T')[0];
    if (today !== this.lastResetDate) {
      this.dailyRequestCount = 0;
      this.lastResetDate = today;
    }

    // Quota check
    if (this.dailyRequestCount >= PRIM_CONFIG.maxDailyRequests) {
      this.logger.warn(`PRIM daily quota reached (${this.dailyRequestCount}/${PRIM_CONFIG.maxDailyRequests})`);
      throw new Error('PRIM daily request quota exceeded');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PRIM_CONFIG.requestTimeoutMs);

    try {
      this.dailyRequestCount++;
      this.logger.debug(`PRIM request #${this.dailyRequestCount}: ${url.substring(0, 120)}...`);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          apikey: PRIM_CONFIG.apiKey,
          Accept: 'application/json',
        },
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`PRIM HTTP ${response.status}: ${response.statusText} — ${text.substring(0, 200)}`);
      }

      return await response.json();
    } catch (err: any) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        throw new Error(`PRIM request timed out (${PRIM_CONFIG.requestTimeoutMs}ms)`);
      }
      throw err;
    }
  }
}
