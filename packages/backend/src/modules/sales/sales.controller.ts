import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SalesService } from './sales.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { CreateSaleDto, PaginationQueryDto } from '../../common/dto';

@ApiTags('sales')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('sales')
export class SalesController {
  constructor(private salesService: SalesService) {}

  @Post()
  @ApiOperation({ summary: 'Create and complete a sale (full POS flow)' })
  create(@Body() dto: CreateSaleDto, @Request() req: any) {
    return this.salesService.createSale(
      req.user.storeId,
      req.user.employeeId,
      dto,
      {
        employeeName: req.user.employeeName,
        employeeRole: req.user.role,
        maxDiscount: req.user.maxDiscount,
      },
    );
  }

  @Get()
  @ApiOperation({ summary: 'List sales for store (paginated, optionally filter by date)' })
  findAll(
    @Request() req: any,
    @Query() query: PaginationQueryDto,
    @Query('date') date?: string,
    @Query('storeId') queryStoreId?: string,
  ) {
    // Admin can query any store via ?storeId=xxx
    const effectiveStoreId = (req.user.role === 'admin' && queryStoreId)
      ? queryStoreId
      : req.user.storeId;
    return this.salesService.findByStore(effectiveStoreId, { ...query, date });
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
  voidSale(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.salesService.voidSale(
      id,
      req.user.employeeId,
      req.user.storeId,
      req.user.role,
      req.user.maxDiscount,
    );
  }
}
