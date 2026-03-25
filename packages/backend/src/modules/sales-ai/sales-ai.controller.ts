import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SalesAiService } from './sales-ai.service';
import { ExternalContextService } from './external-context.service';

@ApiTags('sales-ai')
@ApiBearerAuth()
@Controller('sales-ai')
@UseGuards(JwtAuthGuard)
export class SalesAiController {
  constructor(
    private readonly aiService: SalesAiService,
    private readonly externalContext: ExternalContextService,
  ) {}

  @Get('recommendations')
  @ApiOperation({ summary: 'Get AI-powered sales recommendations for current context' })
  async getRecommendations(
    @Request() req: any,
    @Query('cartProductIds') cartProductIds?: string, // comma-separated
  ) {
    const storeId = req.user.storeId;
    const cart = cartProductIds
      ? cartProductIds.split(',').map((id: string) => ({ productId: id.trim(), name: '' }))
      : [];

    return this.aiService.getRecommendations(storeId, cart);
  }

  @Get('associations')
  @ApiOperation({ summary: 'Get product association data (which products are bought together)' })
  async getAssociations(@Request() req: any) {
    return this.aiService.computeAssociations(req.user.storeId);
  }

  @Get('hourly-patterns')
  @ApiOperation({ summary: 'Get hourly sales patterns' })
  async getHourlyPatterns(@Request() req: any) {
    return this.aiService.computeHourlyPatterns(req.user.storeId);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get store stats and AI readiness' })
  async getStats(@Request() req: any) {
    return this.aiService.getStoreStats(req.user.storeId);
  }

  @Get('time-context')
  @ApiOperation({ summary: 'Get current time context with relevant patterns' })
  async getTimeContext(@Request() req: any) {
    const patterns = await this.aiService.computeHourlyPatterns(req.user.storeId);
    const currentHour = new Date().getHours();
    const currentPattern = patterns.find((p) => p.hour === currentHour);

    return {
      currentHour,
      isRush: currentPattern?.isRush || false,
      currentPattern: currentPattern || null,
      allPatterns: patterns,
      dataAvailable: patterns.length > 0,
    };
  }

  @Get('external-context')
  @ApiOperation({ summary: 'Get weather + transport context for AI enrichment' })
  async getExternalContext(
    @Query('lat') lat?: string,
    @Query('lon') lon?: string,
    @Query('station') station?: string,
  ) {
    return this.externalContext.getFullContext(
      lat ? parseFloat(lat) : undefined,
      lon ? parseFloat(lon) : undefined,
      station || undefined,
    );
  }
}
