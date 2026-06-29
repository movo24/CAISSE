import { Controller, Get, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ComptamaxService } from './comptamax.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';

@ApiTags('comptamax')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('comptamax')
export class ComptamaxController {
  constructor(private readonly comptamax: ComptamaxService) {}

  @Get('journal')
  @Roles('admin', 'manager')
  @ApiOperation({
    summary:
      'POS-INT-74 — daily pre-accounting journal (double-entry) built from the integration outbox. ?date=YYYY-MM-DD&format=csv|json. Tenant-scoped, read-only, no external send.',
  })
  async journal(
    @Request() req: any,
    @Query('date') date: string,
    @Query('format') format?: string,
  ) {
    // storeId comes from the authenticated tenant (anti-IDOR — never from the query).
    const storeId = req.user.storeId;
    if (format === 'csv') {
      return this.comptamax.buildDayJournalCsv(storeId, date);
    }
    return this.comptamax.buildDayJournal(storeId, date);
  }

  @Get('social')
  @Roles('admin', 'manager')
  @ApiOperation({
    summary:
      'POS-INT-84 — TimeWin→Comptamax social pre-accounting export (HR justificatif: hours/absences/lateness). ?period=YYYY-MM&format=csv|json. Best-effort (degrades if TW24 down). NOT real social entries.',
  })
  async social(
    @Request() req: any,
    @Query('period') period: string,
    @Query('format') format?: string,
  ) {
    const storeId = req.user.storeId;
    if (format === 'csv') {
      return this.comptamax.buildSocialExportCsv(storeId, period);
    }
    return this.comptamax.buildSocialExport(storeId, period);
  }
}
