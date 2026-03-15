import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PromotionsService } from './promotions.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { CreatePromoDto, UpdatePromoDto } from '../../common/dto';

@ApiTags('promotions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('promotions')
export class PromotionsController {
  constructor(private promoService: PromotionsService) {}

  @Post()
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Create a promotion rule' })
  create(@Body() dto: CreatePromoDto, @Request() req: any) {
    const { startDate, endDate, ...rest } = dto;
    return this.promoService.create({
      ...rest,
      storeId: req.user.storeId,
      startDate: new Date(startDate),
      ...(endDate ? { endDate: new Date(endDate) } : {}),
    });
  }

  @Get()
  @ApiOperation({ summary: 'List all promotions' })
  findAll(@Request() req: any) {
    return this.promoService.findAll(req.user.storeId);
  }

  @Get('active')
  @ApiOperation({ summary: 'List currently active promotions' })
  getActive(@Request() req: any) {
    return this.promoService.getActivePromos(req.user.storeId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a promotion by ID (tenant-scoped)' })
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.promoService.findOneForStore(id, req.user.storeId);
  }

  @Put(':id')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Update a promotion' })
  update(@Param('id') id: string, @Body() dto: UpdatePromoDto, @Request() req: any) {
    const { startDate, endDate, ...rest } = dto;
    const data: any = { ...rest };
    if (startDate) data.startDate = new Date(startDate);
    if (endDate) data.endDate = new Date(endDate);
    return this.promoService.update(id, data, req.user.storeId);
  }
}
