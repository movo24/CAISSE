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
import { ListSalesQueryDto } from './dto/list-sales-query.dto';

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
    );
  }

  @Get()
  @ApiOperation({ summary: 'List sales for store (paginated, optionally filter by date)' })
  findAll(@Request() req: any, @Query() q: ListSalesQueryDto) {
    // Admin can query any store via ?storeId=xxx
    const effectiveStoreId = (req.user.role === 'admin' && q.storeId)
      ? q.storeId
      : req.user.storeId;
    return this.salesService.findByStore(effectiveStoreId, {
      page: q.page ?? 1,
      limit: q.limit ? Math.min(q.limit, 100) : 50,
      date: q.date,
      employeeId: q.employeeId,
      from: q.from,
      to: q.to,
      status: q.status,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get sale details (tenant-scoped)' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.salesService.findOne(id, req.user.storeId);
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
  ) {
    return this.salesService.voidSale(
      id,
      req.user.employeeId,
      req.user.storeId,
      req.user.role,
      req.user.maxDiscount,
      body?.reason,
      idempotencyKey,
    );
  }
}
