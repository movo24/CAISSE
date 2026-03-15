// ── transport/transport.controller.ts ───────────────────────────
// REST endpoints for transport context
// ─────────────────────────────────────────────────────────────────

import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { TransportService } from './transport.service';

@Controller('transport')
export class TransportController {
  private readonly logger = new Logger('Transport:Controller');

  constructor(private readonly transportService: TransportService) {}

  /**
   * GET /api/transport/status
   * Health check for the transport module.
   */
  @Get('status')
  @SkipThrottle()
  getStatus() {
    return {
      module: 'transport',
      primApiConfigured: this.transportService.isAvailable(),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * GET /api/transport/:storeId
   * Full transport context (stations + disruptions + traffic status).
   */
  @Get(':storeId')
  async getTransportContext(@Param('storeId') storeId: string) {
    try {
      const ctx = await this.transportService.getTransportContext(storeId);
      if (!ctx) {
        return {
          status: 'no_config',
          message:
            'Aucune station configuree. Utilisez POST /api/transport/:storeId/discover-stations.',
          storeId,
        };
      }
      return ctx;
    } catch (err: any) {
      this.logger.error(`getTransportContext error: ${err.message}`);
      throw new HttpException(
        err.message || 'Erreur transport',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * POST /api/transport/:storeId/discover-stations
   * Discover nearby stations via PRIM/Navitia and persist config.
   * Throttled: 2 requests/min max.
   */
  @Post(':storeId/discover-stations')
  @Throttle({ default: { ttl: 60000, limit: 2 } })
  async discoverStations(
    @Param('storeId') storeId: string,
    @Query('radius') radiusStr?: string,
    @Query('count') countStr?: string,
  ) {
    if (!this.transportService.isAvailable()) {
      throw new HttpException(
        'PRIM_API_KEY non configure — module transport desactive',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const radius = radiusStr ? parseInt(radiusStr, 10) : 500;
    const count = countStr ? parseInt(countStr, 10) : 5;

    try {
      const stations = await this.transportService.discoverStations(
        storeId,
        radius,
        count,
      );

      return {
        storeId,
        stationsFound: stations.length,
        stations,
        discoveredAt: new Date().toISOString(),
      };
    } catch (err: any) {
      this.logger.error(`discoverStations error: ${err.message}`);
      const status =
        err.message?.includes('not found')
          ? HttpStatus.NOT_FOUND
          : HttpStatus.INTERNAL_SERVER_ERROR;
      throw new HttpException(err.message, status);
    }
  }

  /**
   * GET /api/transport/:storeId/disruptions
   * Current disruptions for the store's configured lines.
   */
  @Get(':storeId/disruptions')
  async getDisruptions(@Param('storeId') storeId: string) {
    try {
      const disruptions = await this.transportService.getDisruptions(storeId);
      return {
        storeId,
        count: disruptions.length,
        disruptions,
        timestamp: new Date().toISOString(),
      };
    } catch (err: any) {
      this.logger.error(`getDisruptions error: ${err.message}`);
      throw new HttpException(
        err.message || 'Erreur disruptions',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * GET /api/transport/:storeId/stations
   * Get persisted station config (no API call).
   */
  @Get(':storeId/stations')
  @SkipThrottle()
  getStations(@Param('storeId') storeId: string) {
    const stations = this.transportService.getStations(storeId);
    return {
      storeId,
      configured: stations.length > 0,
      count: stations.length,
      stations,
    };
  }
}
