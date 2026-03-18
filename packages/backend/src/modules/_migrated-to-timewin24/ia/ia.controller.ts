import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IaService } from './ia.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { ChatDto, GenerateReportDto } from './dto/chat.dto';

@ApiTags('ia')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
// Rate limit IA endpoints: max 10 requests per minute (expensive Claude API calls)
@Throttle({ default: { ttl: 60000, limit: 10 } })
@Controller('ia')
export class IaController {
  constructor(private iaService: IaService) {}

  // ── Existing rule-based endpoints ────────────────────────────────────

  @Get('pricing/:productId')
  @Roles('admin', 'manager')
  @ApiOperation({
    summary: 'Get AI pricing suggestion for a product (tenant-scoped)',
  })
  suggestPrice(
    @Param('productId') productId: string,
    @Request() req: any,
  ) {
    return this.iaService.suggestPrice(productId, req.user.storeId);
  }

  @Get('forecast')
  @Roles('admin', 'manager')
  @ApiOperation({
    summary: 'Get AI revenue forecast for a date',
  })
  forecastRevenue(
    @Request() req: any,
    @Query('date') date: string,
    @Query('isHoliday') isHoliday?: string,
    @Query('holidayName') holidayName?: string,
  ) {
    return this.iaService.forecastRevenue(
      req.user.storeId,
      date,
      isHoliday === 'true',
      holidayName,
    );
  }

  // ── Claude AI endpoints ──────────────────────────────────────────────

  @Post('chat')
  @Roles('admin', 'manager')
  @ApiOperation({
    summary: 'Chat conversationnel avec Claude AI sur les donnees du magasin',
  })
  chat(@Request() req: any, @Body() dto: ChatDto) {
    return this.iaService.chatWithClaude(
      req.user.storeId,
      dto.message,
      dto.history,
    );
  }

  @Post('report')
  @Roles('admin', 'manager')
  @ApiOperation({
    summary: 'Generer un rapport IA specifique (synthese, analyse, performance)',
  })
  generateReport(@Request() req: any, @Body() dto: GenerateReportDto) {
    return this.iaService.generateAiReport(
      req.user.storeId,
      dto.reportType,
      dto.date,
    );
  }
}
