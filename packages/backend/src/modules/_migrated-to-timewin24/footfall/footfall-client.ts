// ── footfall/footfall-client.ts ──────────────────────────────────
// Low-level Google Places API client
// Uses native fetch, handles auth + timeouts + rate limiting
// ─────────────────────────────────────────────────────────────────

import { Injectable, Logger } from '@nestjs/common';

// ── Configuration ──
export const PLACES_CONFIG = {
  get apiKey(): string {
    return process.env.GOOGLE_MAPS_API_KEY || '';
  },
  get isAvailable(): boolean {
    return PLACES_CONFIG.apiKey.length > 0;
  },
  baseUrl: 'https://maps.googleapis.com/maps/api/place',
  requestTimeoutMs: 10_000,
  maxDailyRequests: 900, // safety margin (free tier ~1000/day for Nearby Search)
};

/** Raw Google Places Nearby Search result */
export interface GooglePlaceResult {
  place_id: string;
  name: string;
  types: string[];
  geometry: {
    location: { lat: number; lng: number };
  };
  rating?: number;
  user_ratings_total?: number;
  business_status?: string;
  vicinity?: string;
  opening_hours?: {
    open_now?: boolean;
  };
}

@Injectable()
export class FootfallClient {
  private readonly logger = new Logger('Footfall:Client');
  private dailyRequestCount = 0;
  private lastResetDate = '';

  /**
   * Fetch nearby places from Google Places Nearby Search API.
   * Returns all results (up to 60 with pagination, default first page = 20).
   */
  async fetchNearbyPlaces(
    lat: number,
    lon: number,
    radiusM = 500,
    type?: string,
  ): Promise<GooglePlaceResult[]> {
    let url =
      `${PLACES_CONFIG.baseUrl}/nearbysearch/json` +
      `?location=${lat},${lon}` +
      `&radius=${radiusM}` +
      `&key=${PLACES_CONFIG.apiKey}`;

    if (type) {
      url += `&type=${type}`;
    }

    const data = await this.request(url);
    const results: GooglePlaceResult[] = data?.results || [];

    // Follow next_page_token for more results (max 2 more pages)
    let nextPageToken = data?.next_page_token;
    let pageCount = 0;

    while (nextPageToken && pageCount < 2) {
      // Google requires a short delay before using the token
      await this.delay(2000);

      const pageUrl =
        `${PLACES_CONFIG.baseUrl}/nearbysearch/json` +
        `?pagetoken=${nextPageToken}` +
        `&key=${PLACES_CONFIG.apiKey}`;

      const pageData = await this.request(pageUrl);
      const pageResults: GooglePlaceResult[] = pageData?.results || [];
      results.push(...pageResults);

      nextPageToken = pageData?.next_page_token;
      pageCount++;
    }

    return results;
  }

  /** Is the Google Places API configured and available? */
  isAvailable(): boolean {
    return PLACES_CONFIG.isAvailable;
  }

  // ═══════════════════════════════════════════════════════════════
  //  PRIVATE — HTTP request with auth, timeout, quota tracking
  // ═══════════════════════════════════════════════════════════════

  private async request(url: string): Promise<any> {
    if (!PLACES_CONFIG.isAvailable) {
      throw new Error('GOOGLE_MAPS_API_KEY not configured');
    }

    // Reset daily counter at midnight
    const today = new Date().toISOString().split('T')[0];
    if (today !== this.lastResetDate) {
      this.dailyRequestCount = 0;
      this.lastResetDate = today;
    }

    // Quota check
    if (this.dailyRequestCount >= PLACES_CONFIG.maxDailyRequests) {
      this.logger.warn(
        `Google Places daily quota reached (${this.dailyRequestCount}/${PLACES_CONFIG.maxDailyRequests})`,
      );
      throw new Error('Google Places daily request quota exceeded');
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      PLACES_CONFIG.requestTimeoutMs,
    );

    try {
      this.dailyRequestCount++;
      this.logger.debug(
        `Places request #${this.dailyRequestCount}: ${url.substring(0, 100)}...`,
      );

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
        },
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(
          `Google Places HTTP ${response.status}: ${response.statusText} — ${text.substring(0, 200)}`,
        );
      }

      const json = await response.json();

      // Check Google API-level errors
      if (json.status && json.status !== 'OK' && json.status !== 'ZERO_RESULTS') {
        throw new Error(
          `Google Places API error: ${json.status} — ${json.error_message || ''}`,
        );
      }

      return json;
    } catch (err: any) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        throw new Error(
          `Google Places request timed out (${PLACES_CONFIG.requestTimeoutMs}ms)`,
        );
      }
      throw err;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
