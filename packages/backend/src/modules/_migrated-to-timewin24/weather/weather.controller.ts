// ── weather/weather.controller.ts ────────────────────────────────
// REST endpoints for weather intelligence
// ─────────────────────────────────────────────────────────────────

import {
  Controller,
  Get,
  Param,
  UseGuards,
  Request,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WeatherService } from './weather.service';

@ApiTags('weather')
@Controller('weather')
export class WeatherController {
  constructor(private readonly weatherService: WeatherService) {}

  /**
   * GET /api/weather/:storeId
   * Full weather response with conditions, forecast, recommendations, traffic impact
   */
  @Get(':storeId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get full weather intelligence for a store',
    description:
      'Returns current conditions, 3h/day forecast, business recommendations, and traffic impact estimate. Cached 30 min.',
  })
  async getWeather(@Param('storeId') storeId: string, @Request() req: any) {
    if (storeId !== req.user.storeId) {
      throw new UnauthorizedException('Access denied');
    }

    const weather = await this.weatherService.getWeather(storeId);
    if (!weather) {
      return {
        error: 'Meteo indisponible — verifiez les coordonnees GPS du magasin',
        current: null,
      };
    }
    return weather;
  }

  /**
   * GET /api/weather/:storeId/simple
   * Legacy format for backward compatibility with existing FluxWidget
   */
  @Get(':storeId/simple')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get simple weather data (legacy format)',
    description: 'Returns {icon, temp, description} — backward compat with existing frontend.',
  })
  async getSimple(@Param('storeId') storeId: string, @Request() req: any) {
    if (storeId !== req.user.storeId) {
      throw new UnauthorizedException('Access denied');
    }

    const weather = await this.weatherService.getWeather(storeId);
    if (!weather) {
      return { icon: null, temp: null, description: 'Non disponible' };
    }

    return this.weatherService.toLegacyFormat(weather);
  }

  /**
   * GET /api/weather/:storeId/snapshot
   * Latest horodated weather snapshot for event correlation
   */
  @Get(':storeId/snapshot')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get latest weather snapshot',
    description: 'Returns the most recent horodated weather snapshot for event correlation.',
  })
  async getSnapshot(@Param('storeId') storeId: string, @Request() req: any) {
    if (storeId !== req.user.storeId) {
      throw new UnauthorizedException('Access denied');
    }

    const snapshot = this.weatherService.getSnapshot(storeId);
    if (!snapshot) {
      // Trigger a fetch to create one
      await this.weatherService.getWeather(storeId);
      return this.weatherService.getSnapshot(storeId) || { error: 'Aucun snapshot disponible' };
    }
    return snapshot;
  }
}
