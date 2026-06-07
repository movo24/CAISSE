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
import { ReturnsService, CreateReturnDto } from './returns.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';

@ApiTags('returns')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('returns')
export class ReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  @Post()
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Create a return / credit note (avoir). Send Idempotency-Key.' })
  create(
    @Body() dto: CreateReturnDto,
    @Request() req: any,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.returns.createReturn(
      req.user.storeId,
      req.user.employeeId,
      dto,
      req.user.employeeName,
      idempotencyKey,
    );
  }

  @Get()
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'List credit notes for the store (paginated)' })
  list(
    @Request() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.returns.listForStore(req.user.storeId, {
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? Math.min(parseInt(limit, 10), 100) : 50,
    });
  }

  @Get('sale/:saleId/returnable')
  @ApiOperation({ summary: 'Returnable quantities for a sale (drives the POS return flow)' })
  returnable(@Param('saleId', ParseUUIDPipe) saleId: string, @Request() req: any) {
    return this.returns.getReturnableForSale(saleId, req.user.storeId);
  }

  @Get(':id')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Get a credit note by id' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.returns.findOne(id, req.user.storeId);
  }
}
