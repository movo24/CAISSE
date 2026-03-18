// ── transport/transport.service.ts ──────────────────────────────
// Main transport context service
// Discovers stations, fetches disruptions, caches 10min, auto-refresh
// ─────────────────────────────────────────────────────────────────

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StoreEntity } from '../../database/entities/store.entity';
import { StoreContextEntity } from '../../database/entities/store-context.entity';
import { PrimClient } from './prim-client';
import {
  TransportMode,
  TransportLine,
  NearbyStation,
  TransportDisruption,
  TransportContext,
  TrafficStatus,
  DisruptionSeverity,
  StoreTransportConfig,
} from './transport.types';

/** Cache entry for transport context (10 min TTL) */
interface TransportCacheEntry {
  data: TransportContext;
  expiresAt: number;
}

const TRANSPORT_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const AUTO_REFRESH_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

@Injectable()
export class TransportService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Transport:Service');

  /** Transport context cache: storeId → { data, expiresAt } */
  private readonly cache = new Map<string, TransportCacheEntry>();

  /** In-memory station configs: storeId → StoreTransportConfig */
  private readonly stationConfigs = new Map<string, StoreTransportConfig>();

  /** Auto-refresh interval handle */
  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectRepository(StoreEntity)
    private readonly storeRepo: Repository<StoreEntity>,
    @InjectRepository(StoreContextEntity)
    private readonly contextRepo: Repository<StoreContextEntity>,
    private readonly primClient: PrimClient,
  ) {}

  // ═══════════════════════════════════════════════════════════════
  //  LIFECYCLE
  // ═══════════════════════════════════════════════════════════════

  async onModuleInit() {
    // Load persisted station configs from DB
    await this.loadStationConfigs();

    // Start auto-refresh for disruptions
    if (this.primClient.isAvailable()) {
      this.refreshInterval = setInterval(
        () => this.refreshAllStores(),
        AUTO_REFRESH_INTERVAL_MS,
      );
      this.logger.log(
        `Transport service initialized — ${this.stationConfigs.size} store(s) configured, auto-refresh every 10min`,
      );
    } else {
      this.logger.warn(
        'PRIM_API_KEY not configured — transport features disabled',
      );
    }
  }

  onModuleDestroy() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  STATION DISCOVERY (PRIM places_nearby → persist)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Discover nearby stations for a store using PRIM/Navitia.
   * Persists the station config in StoreContextEntity.transportConfig.
   */
  async discoverStations(
    storeId: string,
    radiusM = 500,
    count = 5,
  ): Promise<NearbyStation[]> {
    const store = await this.storeRepo.findOne({ where: { id: storeId } });
    if (!store) {
      throw new Error(`Store ${storeId} not found`);
    }

    if (!store.latitude || !store.longitude) {
      throw new Error(
        `Store ${storeId} has no GPS coordinates — cannot discover stations`,
      );
    }

    this.logger.log(
      `Discovering stations for ${store.name} (${store.latitude}, ${store.longitude}, radius=${radiusM}m)`,
    );

    const raw = await this.primClient.fetchNearbyStops(
      store.latitude,
      store.longitude,
      radiusM,
      count,
    );

    const stations = this.parseNavitiaStops(raw);

    if (stations.length === 0) {
      this.logger.warn(
        `No stations found near ${store.name} within ${radiusM}m`,
      );
    } else {
      this.logger.log(
        `Found ${stations.length} station(s): ${stations.map((s) => s.name).join(', ')}`,
      );
    }

    // Persist in DB
    const config: StoreTransportConfig = {
      storeId,
      stations,
      discoveredAt: new Date().toISOString(),
    };

    let entity = await this.contextRepo.findOne({ where: { storeId } });
    if (entity) {
      entity.transportConfig = config;
    } else {
      entity = this.contextRepo.create({
        storeId,
        transportConfig: config,
      });
    }
    await this.contextRepo.save(entity);

    // Update in-memory config
    this.stationConfigs.set(storeId, config);

    // Clear cached context to force refresh
    this.cache.delete(storeId);

    return stations;
  }

  // ═══════════════════════════════════════════════════════════════
  //  TRANSPORT CONTEXT (cache + PRIM line_reports)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get full transport context for a store.
   * Returns cached data if fresh, or fetches from PRIM.
   * Returns null if no stations configured.
   */
  async getTransportContext(storeId: string): Promise<TransportContext | null> {
    const config = this.stationConfigs.get(storeId);
    if (!config || config.stations.length === 0) {
      return null;
    }

    // Check cache
    const cached = this.cache.get(storeId);
    if (cached && cached.expiresAt > Date.now()) {
      this.logger.debug(`Transport cache hit for ${storeId}`);
      return cached.data;
    }

    // Fetch fresh data
    return this.fetchTransportContext(storeId, config);
  }

  /**
   * Get disruptions only (from cached context).
   */
  async getDisruptions(storeId: string): Promise<TransportDisruption[]> {
    const ctx = await this.getTransportContext(storeId);
    return ctx?.disruptions || [];
  }

  /**
   * Get station config (no API call, memory only).
   */
  getStations(storeId: string): NearbyStation[] {
    const config = this.stationConfigs.get(storeId);
    return config?.stations || [];
  }

  // ═══════════════════════════════════════════════════════════════
  //  PROMPT HELPER (for assistant injection)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Returns a formatted string for injection into the assistant's prompt.
   * Returns empty string if transport context unavailable.
   */
  async getContextForPrompt(storeId: string): Promise<string> {
    try {
      const ctx = await this.getTransportContext(storeId);
      if (!ctx) return '';

      const lines: string[] = [
        `\nContexte transport :`,
        `Station la plus proche : ${ctx.station.name} (${ctx.station.distanceM}m).`,
      ];

      // List all lines at the closest station
      if (ctx.station.lines.length > 0) {
        const lineNames = ctx.station.lines
          .map((l) => `${this.modeLabel(l.mode)} ${l.code}`)
          .join(', ');
        lines.push(`Lignes : ${lineNames}.`);
      }

      // Traffic status
      lines.push(`Etat trafic : ${ctx.traffic_status}.`);

      // Disruptions
      if (ctx.disruptions.length > 0) {
        lines.push(`Perturbations :`);
        for (const d of ctx.disruptions.slice(0, 5)) {
          lines.push(`- ${d.line} : ${d.type}, ${d.message}`);
        }
        if (ctx.disruptions.length > 5) {
          lines.push(
            `  (+ ${ctx.disruptions.length - 5} autre(s) perturbation(s))`,
          );
        }
      }

      return lines.join('\n');
    } catch (err: any) {
      this.logger.debug(
        `Transport context unavailable for prompt: ${err.message}`,
      );
      return '';
    }
  }

  /** Is the PRIM API configured? */
  isAvailable(): boolean {
    return this.primClient.isAvailable();
  }

  // ═══════════════════════════════════════════════════════════════
  //  PRIVATE — Fetch + Parse
  // ═══════════════════════════════════════════════════════════════

  /**
   * Fetch transport context from PRIM and cache it.
   */
  private async fetchTransportContext(
    storeId: string,
    config: StoreTransportConfig,
  ): Promise<TransportContext> {
    // Collect all line IDs from all stations
    const lineIds = new Set<string>();
    for (const station of config.stations) {
      for (const line of station.lines) {
        lineIds.add(line.id);
      }
    }

    // Fetch disruptions for those lines
    let disruptions: TransportDisruption[] = [];
    if (lineIds.size > 0) {
      try {
        const raw = await this.primClient.fetchLineReports([...lineIds]);
        disruptions = this.parseLineReports(raw, lineIds);
      } catch (err: any) {
        this.logger.warn(`Failed to fetch disruptions: ${err.message}`);
        // Use stale cache if available
        const stale = this.cache.get(storeId);
        if (stale) {
          this.logger.debug('Using stale transport cache as fallback');
          return stale.data;
        }
      }
    }

    const trafficStatus = this.computeTrafficStatus(disruptions);

    const ctx: TransportContext = {
      station: config.stations[0], // closest station
      allStations: config.stations,
      traffic_status: trafficStatus,
      disruptions,
      activeDisruptionCount: disruptions.length,
      last_update: new Date().toISOString(),
    };

    // Cache
    this.cache.set(storeId, {
      data: ctx,
      expiresAt: Date.now() + TRANSPORT_CACHE_TTL_MS,
    });

    return ctx;
  }

  /**
   * Parse Navitia places_nearby response → NearbyStation[]
   */
  private parseNavitiaStops(raw: any): NearbyStation[] {
    const places: any[] = raw?.places_nearby || [];
    const stations: NearbyStation[] = [];

    for (const place of places) {
      if (place.embedded_type !== 'stop_area') continue;

      const stopArea = place.stop_area;
      if (!stopArea) continue;

      // Parse lines
      const navitiaLines: any[] = stopArea.lines || [];
      const lines: TransportLine[] = navitiaLines.map((l: any) => ({
        id: l.id || '',
        code: l.code || l.name || '',
        name: l.name || l.code || '',
        mode: this.mapMode(l.commercial_mode?.name),
        color: l.color || undefined,
      }));

      // Determine dominant mode
      const modeCounts = new Map<TransportMode, number>();
      for (const line of lines) {
        modeCounts.set(line.mode, (modeCounts.get(line.mode) || 0) + 1);
      }
      let dominantMode: TransportMode = 'other';
      let maxCount = 0;
      // Priority: metro > rer > tram > bus > train > other
      const modePriority: TransportMode[] = [
        'metro',
        'rer',
        'tram',
        'bus',
        'train',
        'other',
      ];
      for (const mode of modePriority) {
        const cnt = modeCounts.get(mode) || 0;
        if (cnt > maxCount) {
          maxCount = cnt;
          dominantMode = mode;
        }
      }

      stations.push({
        id: stopArea.id || '',
        name: stopArea.name || 'Inconnu',
        distanceM: Math.round(Number(place.distance) || 0),
        coord: {
          lat: Number(stopArea.coord?.lat) || 0,
          lon: Number(stopArea.coord?.lon) || 0,
        },
        lines,
        type: dominantMode,
      });
    }

    return stations;
  }

  /**
   * Parse Navitia line_reports disruptions.
   * Filters by the given line IDs.
   */
  private parseLineReports(
    raw: any,
    lineIds: Set<string>,
  ): TransportDisruption[] {
    const disruptions: any[] = raw?.disruptions || [];
    const result: TransportDisruption[] = [];
    const seen = new Set<string>();

    for (const d of disruptions) {
      if (!d.id || seen.has(d.id)) continue;

      // Check if this disruption affects any of our configured lines
      const impactedObjects: any[] = d.impacted_objects || [];
      const affectedLineIds = new Set<string>();
      let affectedLineName = '';

      for (const impact of impactedObjects) {
        const ptObj = impact.pt_object;
        if (ptObj?.type === 'line' && lineIds.has(ptObj.id)) {
          affectedLineIds.add(ptObj.id);
          if (!affectedLineName) {
            affectedLineName = ptObj.name || ptObj.id;
          }
        }
      }

      // Skip disruptions that don't affect our lines
      if (affectedLineIds.size === 0) continue;

      seen.add(d.id);

      // Parse severity
      const severity = this.mapSeverity(d.severity?.effect);

      // Get message
      const messages: any[] = d.messages || [];
      const message =
        messages
          .map((m: any) => m.text)
          .filter(Boolean)
          .join(' ')
          .substring(0, 500) || 'Perturbation en cours';

      // Determine disruption type
      const cause = d.cause || '';
      const disruptionType = this.mapDisruptionType(cause);

      // Date range
      const appPeriods: any[] = d.application_periods || [];
      const startDate = appPeriods[0]?.begin || undefined;
      const endDate = appPeriods[0]?.end || undefined;

      result.push({
        id: d.id,
        line: affectedLineName,
        lineId: [...affectedLineIds][0],
        type: disruptionType,
        severity,
        message,
        cause: cause || undefined,
        startDate,
        endDate,
      });
    }

    return result;
  }

  /**
   * Compute overall traffic status from disruptions.
   */
  private computeTrafficStatus(
    disruptions: TransportDisruption[],
  ): TrafficStatus {
    if (disruptions.length === 0) return 'normal';

    const hasCritical = disruptions.some((d) => d.severity === 'critical');
    if (hasCritical) return 'interrompu';

    return 'perturbe';
  }

  /**
   * Map Navitia commercial_mode name → TransportMode
   */
  private mapMode(modeName?: string): TransportMode {
    if (!modeName) return 'other';
    const lower = modeName.toLowerCase();

    if (lower.includes('metro') || lower.includes('métro')) return 'metro';
    if (lower === 'rer' || lower.includes('rer')) return 'rer';
    if (lower.includes('tram')) return 'tram';
    if (lower.includes('bus')) return 'bus';
    if (
      lower.includes('train') ||
      lower.includes('transilien') ||
      lower.includes('ter')
    )
      return 'train';

    return 'other';
  }

  /**
   * Map Navitia severity effect → DisruptionSeverity
   */
  private mapSeverity(effect?: string): DisruptionSeverity {
    if (!effect) return 'info';
    const upper = effect.toUpperCase();

    if (upper === 'NO_SERVICE') return 'critical';
    if (
      upper === 'SIGNIFICANT_DELAYS' ||
      upper === 'REDUCED_SERVICE' ||
      upper === 'DETOUR'
    )
      return 'warning';

    return 'info';
  }

  /**
   * Map disruption cause to French type label
   */
  private mapDisruptionType(cause: string): string {
    const lower = (cause || '').toLowerCase();

    if (lower.includes('travaux') || lower.includes('maintenance'))
      return 'travaux';
    if (lower.includes('greve') || lower.includes('grève')) return 'greve';
    if (
      lower.includes('incident') ||
      lower.includes('panne') ||
      lower.includes('technique')
    )
      return 'incident';
    if (lower.includes('intemperie') || lower.includes('meteo'))
      return 'intemperie';

    return 'autre';
  }

  /**
   * Human-readable mode label for prompts
   */
  private modeLabel(mode: TransportMode): string {
    const labels: Record<TransportMode, string> = {
      metro: 'Metro',
      rer: 'RER',
      tram: 'Tram',
      bus: 'Bus',
      train: 'Train',
      other: '',
    };
    return labels[mode] || '';
  }

  // ═══════════════════════════════════════════════════════════════
  //  PRIVATE — DB / Auto-refresh
  // ═══════════════════════════════════════════════════════════════

  /**
   * Load station configs from DB into memory at startup.
   */
  private async loadStationConfigs(): Promise<void> {
    try {
      const entities = await this.contextRepo.find({
        where: {},
        select: ['storeId', 'transportConfig'],
      });

      let count = 0;
      for (const entity of entities) {
        if (entity.transportConfig) {
          this.stationConfigs.set(entity.storeId, entity.transportConfig);
          count++;
        }
      }

      this.logger.debug(`Loaded ${count} transport config(s) from DB`);
    } catch (err: any) {
      this.logger.warn(`Failed to load transport configs: ${err.message}`);
    }
  }

  /**
   * Auto-refresh: re-fetch disruptions for all configured stores.
   */
  private async refreshAllStores(): Promise<void> {
    if (this.stationConfigs.size === 0) return;

    this.logger.debug(
      `Auto-refreshing transport for ${this.stationConfigs.size} store(s)...`,
    );

    for (const [storeId, config] of this.stationConfigs) {
      try {
        await this.fetchTransportContext(storeId, config);
      } catch (err: any) {
        this.logger.debug(
          `Auto-refresh failed for ${storeId}: ${err.message}`,
        );
      }
    }
  }
}
