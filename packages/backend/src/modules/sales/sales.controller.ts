import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  Headers,
  UseGuards,
  Request,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SalesService } from './sales.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { CreateSaleDto } from '../../common/dto';

@ApiTags('sales')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('sales')
export class SalesController {
  constructor(private salesService: SalesService) {}

  @Post()
  @ApiOperation({ summary: 'Create and complete a sale (full POS flow). Send Idempotency-Key to dedupe offline-sync replays.' })
  create(
    @Body() dto: CreateSaleDto,
    @Request() req: any,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('x-terminal-id') terminalId?: string,
    @Headers('x-machine-id') machineId?: string,
    // MODE TEST pilote : marqueur porté par un EN-TÊTE (pas le corps) — un backend
    // qui ne connaît pas ce header l'ignore (aucun rejet forbidNonWhitelisted),
    // donc la caisse vend même si le backend n'est pas encore à jour. Honoré
    // seulement si le serveur autorise lui-même le bypass (voir SalesService).
    @Headers('x-pos-test-mode') testMode?: string,
  ) {
    return this.salesService.createSale(
      req.user.storeId,
      req.user.employeeId,
      dto,
      {
        employeeName: req.user.employeeName,
        employeeRole: req.user.role,
        maxDiscount: req.user.maxDiscount,
      },
      idempotencyKey,
      terminalId,
      machineId,
      testMode === '1' || testMode === 'true',
    );
  }

  @Get()
  @ApiOperation({ summary: 'List sales for store (paginated, optionally filter by date)' })
  findAll(
    @Request() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('date') date?: string,
    @Query('storeId') queryStoreId?: string,
  ) {
    // Admin can query any store via ?storeId=xxx
    const effectiveStoreId = (req.user.role === 'admin' && queryStoreId)
      ? queryStoreId
      : req.user.storeId;
    return this.salesService.findByStore(effectiveStoreId, {
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? Math.min(parseInt(limit, 10), 100) : 50,
      date,
    });
  }

  // ── Payment to regularise (decision 6) — static route BEFORE :id ──
  @Get('pending-payments')
  @Roles('admin', 'manager')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'List sales with an uncaptured card leg (à régulariser)' })
  pendingPayments(@Request() req: any) {
    return this.salesService.listPendingPayments(req.user.storeId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get sale details (tenant-scoped)' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.salesService.findOne(id, req.user.storeId);
  }

  @Post(':id/regularize-payment')
  @Roles('admin', 'manager')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Regularise a pending card leg (capture really taken / failed)' })
  regularizePayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() body: { paymentId?: string; stripePaymentIntentId?: string; success: boolean },
  ) {
    return this.salesService.regularizePayment(id, req.user.storeId, req.user.employeeId, {
      paymentId: body?.paymentId,
      stripePaymentIntentId: body?.stripePaymentIntentId,
      success: !!body?.success,
    });
  }

  @Post(':id/void')
  @Roles('admin', 'manager')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Void a sale (restores stock, logs audit)' })
  voidSale(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() body?: { reason?: string },
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('x-terminal-id') terminalId?: string,
  ) {
    return this.salesService.voidSale(
      id,
      req.user.employeeId,
      req.user.storeId,
      req.user.role,
      req.user.maxDiscount,
      body?.reason,
      idempotencyKey,
      terminalId,
    );
  }
}
