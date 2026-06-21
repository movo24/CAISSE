import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  Header,
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
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('products')
export class ProductsController {
  constructor(private productsService: ProductsService) {}

  @Post()
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Create a product' })
  create(@Body() dto: CreateProductDto, @Request() req: any) {
    return this.productsService.create(
      { ...dto, storeId: req.user.storeId },
      req.user.employeeId,
    );
  }

  @Get()
  @ApiOperation({ summary: 'List products for store (paginated; filter by search/brand/supplier)' })
  findAll(
    @Request() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('storeId') queryStoreId?: string,
    @Query('brandId') brandId?: string,
    @Query('supplierId') supplierId?: string,
  ) {
    const effectiveStoreId = (req.user.role === 'admin' && queryStoreId)
      ? queryStoreId
      : req.user.storeId;
    return this.productsService.findAll(effectiveStoreId, {
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? Math.min(parseInt(limit, 10), 100) : 50,
      search,
      brandId,
      supplierId,
    });
  }

  // ── Brand / supplier reference data (decision 3) — static routes before :id ──

  @Get('brands')
  @ApiOperation({ summary: 'List brands for the store' })
  listBrands(@Request() req: any) {
    return this.productsService.listBrands(req.user.storeId);
  }

  @Post('brands')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Create (or get) a brand by name' })
  createBrand(@Body() body: { name: string }, @Request() req: any) {
    return this.productsService.getOrCreateBrand(req.user.storeId, body?.name ?? '');
  }

  @Get('suppliers')
  @ApiOperation({ summary: 'List suppliers for the store' })
  listSuppliers(@Request() req: any) {
    return this.productsService.listSuppliers(req.user.storeId);
  }

  @Post('suppliers')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Create (or get) a supplier by name' })
  createSupplier(@Body() body: { name: string }, @Request() req: any) {
    return this.productsService.getOrCreateSupplier(req.user.storeId, body?.name ?? '');
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
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Create a product category' })
  createCategory(@Request() req: any, @Body() body: { name: string }) {
    return this.productsService.createCategory(req.user.storeId, body.name);
  }

  @Get('stock-alerts')
  @ApiOperation({ summary: 'Get stock alerts (low + critical, paginated)' })
  stockAlerts(@Request() req: any, @Query() query: PaginationQueryDto) {
    return this.productsService.getStockAlerts(req.user.storeId, {
      page: query.page,
      limit: query.limit,
    });
  }

  // ── CSV bulk import/export (Bloc 4i) — static routes BEFORE :id ──

  @Get('export')
  @Roles('admin', 'manager')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="products.csv"')
  @ApiOperation({ summary: 'Export the store catalog as CSV (round-trippable with import)' })
  exportCsv(@Request() req: any, @Query('storeId') queryStoreId?: string) {
    const effectiveStoreId =
      req.user.role === 'admin' && queryStoreId ? queryStoreId : req.user.storeId;
    return this.productsService.exportCsv(effectiveStoreId);
  }

  @Post('import')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Bulk import/update products from CSV (per-row validation + report)' })
  importCsv(@Body() body: { csv: string }, @Request() req: any) {
    return this.productsService.importCsv(req.user.storeId, body?.csv ?? '', req.user.employeeId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a product by ID' })
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.productsService.findOneForStore(id, req.user.storeId);
  }

  // ── Variants / SKU (decision 5) ──

  @Get(':id/variants')
  @ApiOperation({ summary: 'List the variants of a product' })
  listVariants(@Param('id') id: string, @Request() req: any) {
    return this.productsService.listVariants(id, req.user.storeId);
  }

  @Post(':id/variants')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Create a variant (own ean/sku/price/stock) under a product' })
  createVariant(
    @Param('id') id: string,
    @Body() body: { ean: string; variantName: string; priceMinorUnits: number; sku?: string; stockQuantity?: number; taxRate?: number; costMinorUnits?: number },
    @Request() req: any,
  ) {
    return this.productsService.createVariant(id, req.user.storeId, body, req.user.employeeId);
  }

  // ── Per-store price override (decision 4) ──

  @Get(':id/store-price')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Get the per-store price override for a product (if any)' })
  getStorePrice(@Param('id') id: string, @Request() req: any) {
    return this.productsService.getStoreOverride(req.user.storeId, id);
  }

  @Put(':id/store-price')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Set the per-store price override (wins over base at sale; historised)' })
  setStorePrice(
    @Param('id') id: string,
    @Body() body: { priceMinorUnits: number; startsAt?: string; endsAt?: string },
    @Request() req: any,
  ) {
    return this.productsService.setStoreOverride(
      req.user.storeId,
      id,
      body.priceMinorUnits,
      req.user.employeeId,
      { startsAt: body.startsAt ? new Date(body.startsAt) : null, endsAt: body.endsAt ? new Date(body.endsAt) : null },
      req.user.role,
    );
  }

  @Delete(':id/store-price')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Clear the per-store price override (back to base; historised)' })
  clearStorePrice(@Param('id') id: string, @Request() req: any) {
    return this.productsService.clearStoreOverride(req.user.storeId, id, req.user.employeeId, req.user.role);
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
  @Roles('admin', 'manager')
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
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Generate internal barcode for a product without one' })
  async generateBarcode(@Param('id') id: string, @Request() req: any) {
    return this.productsService.generateBarcode(id, req.user.storeId);
  }

  @Delete(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Soft-delete a product (deactivate)' })
  async remove(@Param('id') id: string, @Request() req: any) {
    return this.productsService.deactivate(id, req.user.storeId);
  }
}
