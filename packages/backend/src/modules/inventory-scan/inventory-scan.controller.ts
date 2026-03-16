import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Request,
  Param,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { InventoryScanService, CreateScanDto } from './inventory-scan.service';
import { BusinessError } from '../../common/errors/business-error';

@ApiTags('inventory-scans')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('inventory-scans')
export class InventoryScanController {
  constructor(private scanService: InventoryScanService) {}

  /**
   * POST /api/inventory-scans — record a barcode scan.
   * The store is automatically resolved from the authenticated user's session.
   * If no store is assigned → 400 error.
   */
  @Post()
  @ApiOperation({ summary: 'Record a barcode scan (requires store assignment)' })
  async recordScan(@Request() req: any, @Body() dto: CreateScanDto) {
    const storeId = req.user?.storeId;
    const employeeId = req.user?.employeeId;

    if (!storeId) {
      throw BusinessError.invalidRelation(
        'Aucun magasin selectionne. Veuillez choisir un magasin avant de scanner.',
      );
    }

    return this.scanService.recordScan(storeId, employeeId, dto);
  }

  /**
   * GET /api/inventory-scans — list scans for the current store.
   */
  @Get()
  @ApiOperation({ summary: 'List inventory scans for current store' })
  listScans(
    @Request() req: any,
    @Query('sessionId') sessionId?: string,
    @Query('status') status?: string,
    @Query('scanType') scanType?: string,
    @Query('limit') limit?: string,
  ) {
    const storeId = req.user?.storeId;
    if (!storeId) {
      throw BusinessError.invalidRelation('Aucun magasin selectionne.');
    }

    return this.scanService.listScans(storeId, {
      sessionId,
      status,
      scanType,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  /**
   * POST /api/inventory-scans/apply — apply pending scans to stock.
   * Updates product quantities for the current store only.
   */
  @Post('apply')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Apply pending scans to stock (admin/manager)' })
  async applyScans(
    @Request() req: any,
    @Body() body: { sessionId?: string },
  ) {
    const storeId = req.user?.storeId;
    const employeeId = req.user?.employeeId;

    if (!storeId) {
      throw BusinessError.invalidRelation('Aucun magasin selectionne.');
    }

    return this.scanService.applyScansToStock(
      storeId,
      employeeId,
      body.sessionId,
    );
  }

  /**
   * GET /api/inventory-scans/session/:sessionId/stats — get session statistics.
   */
  @Get('session/:sessionId/stats')
  @ApiOperation({ summary: 'Get scan session statistics' })
  getSessionStats(
    @Request() req: any,
    @Param('sessionId') sessionId: string,
  ) {
    const storeId = req.user?.storeId;
    if (!storeId) {
      throw BusinessError.invalidRelation('Aucun magasin selectionne.');
    }

    return this.scanService.getSessionStats(storeId, sessionId);
  }
}
