import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ProductsService } from './products.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
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
  @ApiOperation({ summary: 'List products for store (paginated, admin can filter by storeId)' })
  findAll(
    @Request() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('storeId') queryStoreId?: string,
  ) {
    const effectiveStoreId = (req.user.role === 'admin' && queryStoreId)
      ? queryStoreId
      : req.user.storeId;
    return this.productsService.findAll(effectiveStoreId, {
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? Math.min(parseInt(limit, 10), 100) : 50,
      search,
    });
  }

  @Get('scan/:ean')
  @ApiOperation({ summary: 'Find product by EAN barcode' })
  async findByEan(@Param('ean') ean: string, @Request() req: any) {
    const product = await this.productsService.findByEan(ean, req.user.storeId);
    if (!product) {
      throw new NotFoundException(`Produit introuvable pour le code EAN: ${ean}`);
    }
    return product;
  }

  @Get('categories')
  @ApiOperation({ summary: 'List product categories for store' })
  getCategories(@Request() req: any) {
    return this.productsService.getCategories(req.user.storeId);
  }

  @Post('categories')
  @ApiOperation({ summary: 'Create a product category' })
  createCategory(@Request() req: any, @Body() body: { name: string }) {
    return this.productsService.createCategory(req.user.storeId, body.name);
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

  @Get(':id/price-analytics')
  @ApiOperation({ summary: 'Get price analytics with sales impact per period' })
  priceAnalytics(@Param('id') id: string, @Request() req: any) {
    return this.productsService.getPriceAnalytics(id, req.user.storeId);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a product' })
  update(@Param('id') id: string, @Body() dto: UpdateProductDto, @Request() req: any) {
    const { reason, ...data } = dto;
    // Detect change source from user-agent
    const ua = (req.headers?.['user-agent'] || '').toLowerCase();
    const changeSource = ua.includes('mobile') || ua.includes('ipad') || ua.includes('iphone')
      ? 'mobile' : 'backoffice';

    return this.productsService.update(
      id,
      data,
      req.user.employeeId,
      reason,
      req.user.storeId,
      changeSource,
      req.user.role,
    );
  }

  @Post(':id/generate-barcode')
  @UseGuards(RolesGuard)
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Generate internal barcode for a product without one' })
  async generateBarcode(@Param('id') id: string, @Request() req: any) {
    return this.productsService.generateBarcode(id, req.user.storeId);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Soft-delete a product (deactivate)' })
  async remove(@Param('id') id: string, @Request() req: any) {
    return this.productsService.deactivate(id, req.user.storeId);
  }
}
