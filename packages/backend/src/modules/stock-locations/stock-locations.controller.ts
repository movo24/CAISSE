import {
  Controller, Get, Post, Param, Body, Request, Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { StockLocationsService } from './stock-locations.service';

@ApiTags('stock-locations')
@ApiBearerAuth()
@Controller('stock-locations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StockLocationsController {
  constructor(private readonly service: StockLocationsService) {}

  // ─── LOCATIONS ─────────────────────────────────────────────────

  @Get('locations')
  @ApiOperation({ summary: 'List all stock locations' })
  listLocations() {
    return this.service.listLocations();
  }

  @Post('locations')
  @Roles('admin')
  @ApiOperation({ summary: 'Create a stock location' })
  createLocation(@Body() body: {
    name: string;
    code: string;
    type: 'central' | 'store' | 'transit' | 'loss';
    storeId?: string;
    address?: string;
  }) {
    return this.service.createLocation(body);
  }

  // ─── STOCK VIEWS ───────────────────────────────────────────────

  @Get('network')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'View stock across all locations' })
  getNetworkStock() {
    return this.service.getNetworkStock();
  }

  // M107 — READ-ONLY: products whose legacy stock_quantity disagrees with the sum of
  // their location balances. Diagnostic only (no mutation, no correction).
  @Get('divergences')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Read-only report: legacy stock_quantity vs SUM(stock_balances) divergences (M107)' })
  getStockDivergences(@Query('storeId') storeId?: string) {
    return this.service.findStockDivergences(storeId);
  }

  @Get('product/:productId/balances')
  @ApiOperation({ summary: 'Stock balances for a product across all locations' })
  getProductBalances(@Param('productId') productId: string) {
    return this.service.getBalancesForProduct(productId);
  }

  @Get('location/:locationId/balances')
  @ApiOperation({ summary: 'All products stock at a location' })
  getLocationBalances(@Param('locationId') locationId: string) {
    return this.service.getBalancesForLocation(locationId);
  }

  // ─── OPERATIONS ────────────────────────────────────────────────

  @Post('receive')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Receive stock from supplier' })
  receiveFromSupplier(
    @Body() body: {
      productId: string;
      locationId: string;
      quantity: number;
      reference?: string;
      reason?: string;
    },
    @Request() req: any,
  ) {
    return this.service.receiveFromSupplier({
      ...body,
      employeeId: req.user.employeeId,
      employeeName: req.user.employeeName || req.user.employeeId,
    });
  }

  @Post('transfer')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Transfer stock between locations' })
  transfer(
    @Body() body: {
      productId: string;
      fromLocationId: string;
      toLocationId: string;
      quantity: number;
      reference?: string;
      reason?: string;
    },
    @Request() req: any,
  ) {
    return this.service.transfer({
      ...body,
      employeeId: req.user.employeeId,
      employeeName: req.user.employeeName || req.user.employeeId,
    });
  }

  @Post('loss')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Record a stock loss (casse / vol / périmé / inconnu) — reason required' })
  recordLoss(
    @Body() body: {
      productId: string;
      locationId: string;
      quantity: number;
      lossType: 'loss_breakage' | 'loss_theft' | 'loss_expired' | 'loss_unknown';
      reason: string;
    },
    @Request() req: any,
  ) {
    return this.service.recordLoss({
      ...body,
      employeeId: req.user.employeeId,
      employeeName: req.user.employeeName || req.user.employeeId,
    });
  }

  @Post('dispatch')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Dispatch stock from central to multiple stores' })
  dispatch(
    @Body() body: {
      productId: string;
      fromLocationId: string;
      dispatches: { toLocationId: string; quantity: number }[];
      reference?: string;
    },
    @Request() req: any,
  ) {
    return this.service.dispatch({
      ...body,
      employeeId: req.user.employeeId,
      employeeName: req.user.employeeName || req.user.employeeId,
    });
  }

  // ─── HISTORY ───────────────────────────────────────────────────

  @Get('movements/product/:productId')
  @ApiOperation({ summary: 'Movement history for a product' })
  getProductMovements(
    @Param('productId') productId: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.getMovements(productId, limit ? parseInt(limit, 10) : 50);
  }

  @Get('movements/location/:locationId')
  @ApiOperation({ summary: 'Movement history for a location' })
  getLocationMovements(
    @Param('locationId') locationId: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.getLocationMovements(locationId, limit ? parseInt(limit, 10) : 50);
  }
}
