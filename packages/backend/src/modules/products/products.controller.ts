import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ProductsService } from './products.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CreateProductDto, UpdateProductDto, PaginationQueryDto } from '../../common/dto';

@ApiTags('products')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('products')
export class ProductsController {
  constructor(private productsService: ProductsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a product' })
  create(@Body() dto: CreateProductDto, @Request() req: any) {
    return this.productsService.create(
      { ...dto, storeId: req.user.storeId },
      req.user.employeeId,
    );
  }

  @Get()
  @ApiOperation({ summary: 'List products for store (paginated)' })
  findAll(@Request() req: any, @Query() query: PaginationQueryDto) {
    return this.productsService.findAll(req.user.storeId, query);
  }

  @Get('scan/:ean')
  @ApiOperation({ summary: 'Find product by EAN barcode' })
  findByEan(@Param('ean') ean: string, @Request() req: any) {
    return this.productsService.findByEan(ean, req.user.storeId);
  }

  @Get('categories')
  @ApiOperation({ summary: 'List distinct product categories for store' })
  getCategories(@Request() req: any) {
    return this.productsService.getCategories(req.user.storeId);
  }

  @Get('stock-alerts')
  @ApiOperation({ summary: 'Get stock alerts (low + critical)' })
  stockAlerts(@Request() req: any) {
    return this.productsService.getStockAlerts(req.user.storeId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a product by ID' })
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.productsService.findOneForStore(id, req.user.storeId);
  }

  @Get(':id/price-history')
  @ApiOperation({ summary: 'Get price change history' })
  priceHistory(@Param('id') id: string, @Request() req: any) {
    return this.productsService.getPriceHistory(id, req.user.storeId);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a product' })
  update(@Param('id') id: string, @Body() dto: UpdateProductDto, @Request() req: any) {
    const { reason, ...data } = dto;
    return this.productsService.update(
      id,
      data,
      req.user.employeeId,
      reason,
      req.user.storeId,
    );
  }
}
