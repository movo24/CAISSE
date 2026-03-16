// ── footfall/footfall.controller.ts ──────────────────────────────
// REST endpoints for footfall (foot traffic) context
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
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { FootfallService } from './footfall.service';

@Controller('footfall')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'manager')
export class FootfallController {
  private readonly logger = new Logger('Footfall:Controller');

  constructor(private readonly footfallService: FootfallService) {}

  /**
   * GET /api/footfall/status
   * Health check for the footfall module.
   */
  @Get('status')
  @SkipThrottle()
  getStatus() {
    return {
      module: 'footfall',
      googlePlacesConfigured: this.footfallService.isAvailable(),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * GET /api/footfall/:storeId
   * Full footfall context (score + traffic level + nearby places).
   */
  @Get(':storeId')
  async getFootfallContext(@Param('storeId') storeId: string) {
    try {
      const ctx = await this.footfallService.getFootfallContext(storeId);
      if (!ctx) {
        return {
          status: 'no_config',
          message:
            'Aucun lieu decouvert. Utilisez POST /api/footfall/:storeId/discover pour analyser la zone.',
          storeId,
        };
      }
      return ctx;
    } catch (err: any) {
      this.logger.error(`getFootfallContext error: ${err.message}`);
      throw new HttpException(
        err.message || 'Erreur footfall',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * POST /api/footfall/:storeId/discover
   * Discover nearby places via Google Places API and compute footfall score.
   * Throttled: 2 requests/min max.
   */
  @Post(':storeId/discover')
  @Throttle({ default: { ttl: 60000, limit: 2 } })
  async discoverPlaces(
    @Param('storeId') storeId: string,
    @Query('radius') radiusStr?: string,
  ) {
    if (!this.footfallService.isAvailable()) {
      throw new HttpException(
        'GOOGLE_MAPS_API_KEY non configure — module footfall desactive',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const radius = radiusStr ? parseInt(radiusStr, 10) : 500;

    try {
      const ctx = await this.footfallService.discoverPlaces(storeId, radius);

      return {
        storeId,
        footfallScore: ctx.footfallScore,
        nearbyTrafficLevel: ctx.nearbyTrafficLevel,
        placesFound: ctx.totalNearbyPlaces,
        totalUserRatings: ctx.totalUserRatings,
        topPlaces: ctx.topPlaces.slice(0, 5).map((p) => ({
          name: p.name,
          category: p.category,
          userRatingsTotal: p.userRatingsTotal,
          distanceM: p.distanceM,
        })),
        discoveredAt: ctx.updatedAt,
      };
    } catch (err: any) {
      this.logger.error(`discoverPlaces error: ${err.message}`);
      const status = err.message?.includes('not found')
        ? HttpStatus.NOT_FOUND
        : HttpStatus.INTERNAL_SERVER_ERROR;
      throw new HttpException(err.message, status);
    }
  }

  /**
   * POST /api/footfall/:storeId/refresh
   * Force refresh: re-fetch from Google Places API.
   * Throttled: 2 requests/min max.
   */
  @Post(':storeId/refresh')
  @Throttle({ default: { ttl: 60000, limit: 2 } })
  async refreshFootfall(@Param('storeId') storeId: string) {
    if (!this.footfallService.isAvailable()) {
      throw new HttpException(
        'GOOGLE_MAPS_API_KEY non configure — module footfall desactive',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    try {
      const ctx = await this.footfallService.refreshFootfall(storeId);
      return {
        storeId,
        footfallScore: ctx.footfallScore,
        nearbyTrafficLevel: ctx.nearbyTrafficLevel,
        placesFound: ctx.totalNearbyPlaces,
        refreshedAt: ctx.updatedAt,
      };
    } catch (err: any) {
      this.logger.error(`refreshFootfall error: ${err.message}`);
      throw new HttpException(
        err.message || 'Erreur refresh footfall',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
