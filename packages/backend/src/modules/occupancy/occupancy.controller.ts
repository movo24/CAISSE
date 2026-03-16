import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Headers,
  UseGuards,
  Request,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { OccupancyService } from './occupancy.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SkipTenantCheck } from '../../common/interceptors/tenant.interceptor';
import { WeatherService } from '../weather/weather.service';

@ApiTags('occupancy')
@Controller('occupancy')
export class OccupancyController {
  constructor(
    private readonly occupancyService: OccupancyService,
    private readonly weatherService: WeatherService,
  ) {}

  /**
   * POST /api/occupancy/update
   * Receives live_count from the radar scanning software.
   * Authenticated via X-Radar-Key header (shared secret per store).
   */
  @Post('update')
  @SkipTenantCheck()
  @ApiOperation({
    summary: 'Update store occupancy from radar sensor',
  })
  update(
    @Body() body: { storeId: string; liveCount: number },
    @Headers('x-radar-key') radarKey: string,
  ) {
    // Validate radar key (env-based shared secret — no fallback)
    const expectedKey = process.env.RADAR_API_KEY;
    if (!expectedKey) {
      throw new UnauthorizedException('RADAR_API_KEY not configured on server');
    }
    if (!radarKey || radarKey !== expectedKey) {
      throw new UnauthorizedException('Invalid radar API key');
    }

    if (!body.storeId) {
      throw new BadRequestException('storeId is required');
    }
    if (typeof body.liveCount !== 'number' || body.liveCount < 0) {
      throw new BadRequestException('liveCount must be a non-negative number');
    }

    return this.occupancyService.updateOccupancy(body.storeId, body.liveCount);
  }

  /**
   * GET /api/occupancy/:storeId
   * Returns current live_count for the store. JWT-authenticated.
   */
  @Get(':storeId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current store occupancy' })
  getOccupancy(@Param('storeId') storeId: string, @Request() req: any) {
    // Tenant check: only your own store
    if (storeId !== req.user.storeId) {
      throw new UnauthorizedException('Access denied');
    }
    return this.occupancyService.getOccupancy(storeId);
  }

  /**
   * GET /api/occupancy/:storeId/weather
   * PROXY → WeatherModule (retro-compat with legacy format)
   * The old occupancy weather is replaced by the new Weather module.
   */
  @Get(':storeId/weather')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get weather (proxied to Weather module, legacy format)' })
  async getWeather(@Param('storeId') storeId: string, @Request() req: any) {
    if (storeId !== req.user.storeId) {
      throw new UnauthorizedException('Access denied');
    }
    const weather = await this.weatherService.getWeather(storeId);
    if (!weather) {
      return { icon: null, temp: null, description: 'Non disponible' };
    }
    // Return legacy format for backward compat
    const legacy = this.weatherService.toLegacyFormat(weather);
    return {
      icon: legacy.icon,
      temp: legacy.temp,
      description: legacy.description,
      city: weather.storeCity,
    };
  }
}
