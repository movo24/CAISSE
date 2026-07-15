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
import {
  CreateProductDto,
  UpdateProductDto,
  PaginationQueryDto,
  CreateCategoryDto,
  UpdateCategoryDto,
  BulkProductActionDto,
} from '../../common/dto';

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
  @ApiOperation({ summary: 'List products for store (paginated; filter by search/brand/supplier/category/status; sortable)' })
  findAll(
    @Request() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('storeId') queryStoreId?: string,
    @Query('brandId') brandId?: string,
    @Query('supplierId') supplierId?: string,
    @Query('categoryId') categoryId?: string,
    @Query('status') status?: string,
    @Query('taxRate') taxRate?: string,
    @Query('outOfStock') outOfStock?: string,
    @Query('belowThreshold') belowThreshold?: string,
    @Query('noImage') noImage?: string,
    @Query('noSupplier') noSupplier?: string,
    @Query('noCategory') noCategory?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
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
      categoryId,
      status,
      taxRate: taxRate !== undefined && taxRate !== '' ? Number(taxRate) : undefined,
      outOfStock: outOfStock === 'true',
      belowThreshold: belowThreshold === 'true',
      noImage: noImage === 'true',
      noSupplier: noSupplier === 'true',
      noCategory: noCategory === 'true',
      sortBy,
      sortDir,
    });
  }

  @Get('catalog-stats')
  @ApiOperation({ summary: 'Catalog header counts (total, active, out-of-stock, below-threshold, missing data)' })
  catalogStats(@Request() req: any, @Query('storeId') queryStoreId?: string) {
    const effectiveStoreId =
      req.user.role === 'admin' && queryStoreId ? queryStoreId : req.user.storeId;
    return this.productsService.getCatalogStats(effectiveStoreId);
  }

  @Post('bulk')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Bulk action on selected products (activate/deactivate/setCategory/setSupplier/setTax) — audited, returns per-id result' })
  bulkAction(@Body() dto: BulkProductActionDto, @Request() req: any) {
    return this.productsService.bulkAction(
      req.user.storeId,
      req.user.employeeId,
      dto.action,
      dto.productIds,
      { categoryId: dto.categoryId, supplierId: dto.supplierId, taxRate: dto.taxRate },
    );
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
  @ApiOperation({ summary: 'List product categories (tree: id, name, parentId, productCount)' })
  getCategories(@Request() req: any) {
    return this.productsService.getCategories(req.user.storeId);
  }

  @Post('categories')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Create a product category (optional parentId for a sub-category)' })
  createCategory(@Request() req: any, @Body() body: CreateCategoryDto) {
    return this.productsService.createCategory(req.user.storeId, body.name, body.parentId ?? null);
  }

  @Put('categories/:categoryId')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Rename and/or move a category (cycle-safe)' })
  updateCategory(
    @Param('categoryId') categoryId: string,
    @Body() body: UpdateCategoryDto,
    @Request() req: any,
  ) {
    return this.productsService.updateCategory(req.user.storeId, categoryId, body);
  }

  @Delete('categories/:categoryId')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Delete a category (refused if it has sub-categories or attached products)' })
  deleteCategory(@Param('categoryId') categoryId: string, @Request() req: any) {
    return this.productsService.deleteCategory(req.user.storeId, categoryId);
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

  @Post(':id/variants/generate')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Generate variants from attributes (cartesian product, e.g. size × color)' })
  generateVariants(
    @Param('id') id: string,
    @Body() body: { attributes: Array<{ name: string; values: string[] }>; priceMinorUnits?: number },
    @Request() req: any,
  ) {
    return this.productsService.generateVariants(id, req.user.storeId, body?.attributes ?? [], req.user.employeeId, {
      priceMinorUnits: body?.priceMinorUnits,
    });
  }

  // ── Product Packs — composition d'un produit composé (GO owner 2026-07-09) ──

  @Get(':id/components')
  @ApiOperation({ summary: 'List the pack components of a product (parent = billed product)' })
  listComponents(@Param('id') id: string, @Request() req: any) {
    return this.productsService.listComponents(id, req.user.storeId);
  }

  @Post(':id/components')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Add a component to a pack (loop-safe, unique per parent+component)' })
  addComponent(
    @Param('id') id: string,
    @Body() body: { componentProductId: string; quantityPerParent: number },
    @Request() req: any,
  ) {
    return this.productsService.addComponent(id, req.user.storeId, body);
  }

  @Put(':id/components/:componentRowId')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Update quantity and/or active flag of a pack component' })
  updateComponent(
    @Param('id') id: string,
    @Param('componentRowId') componentRowId: string,
    @Body() body: { quantityPerParent?: number; isActive?: boolean },
    @Request() req: any,
  ) {
    return this.productsService.updateComponent(id, componentRowId, req.user.storeId, body);
  }

  @Delete(':id/components/:componentRowId')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Remove a component from the CURRENT composition (sale history keeps its snapshot)' })
  removeComponent(
    @Param('id') id: string,
    @Param('componentRowId') componentRowId: string,
    @Request() req: any,
  ) {
    return this.productsService.removeComponent(id, componentRowId, req.user.storeId);
  }

  // ── Fournisseurs multiples (Lot B) ──

  @Get(':id/suppliers')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'List the suppliers of a product (with purchase conditions)' })
  listProductSuppliers(@Param('id') id: string, @Request() req: any) {
    return this.productsService.listProductSuppliers(id, req.user.storeId);
  }

  @Post(':id/suppliers')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Attach a supplier with purchase conditions' })
  addProductSupplier(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.productsService.addProductSupplier(id, req.user.storeId, body ?? {});
  }

  @Put(':id/suppliers/:rowId')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Update a product-supplier line' })
  updateProductSupplier(@Param('id') id: string, @Param('rowId') rowId: string, @Body() body: any, @Request() req: any) {
    return this.productsService.updateProductSupplier(id, req.user.storeId, rowId, body ?? {});
  }

  @Delete(':id/suppliers/:rowId')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Detach a supplier from the product' })
  removeProductSupplier(@Param('id') id: string, @Param('rowId') rowId: string, @Request() req: any) {
    return this.productsService.removeProductSupplier(id, req.user.storeId, rowId);
  }

  // ── Codes-barres multiples (Lot A) ──

  @Get(':id/barcodes')
  @ApiOperation({ summary: 'List additional barcodes of a product' })
  listBarcodes(@Param('id') id: string, @Request() req: any) {
    return this.productsService.listBarcodes(id, req.user.storeId);
  }

  @Post(':id/barcodes')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Add a barcode (EAN/UPC/GTIN); unique per store' })
  addBarcode(
    @Param('id') id: string,
    @Body() body: { barcode: string; type?: string; isPrimary?: boolean },
    @Request() req: any,
  ) {
    return this.productsService.addBarcode(id, req.user.storeId, body?.barcode ?? '', body?.type, body?.isPrimary);
  }

  @Put(':id/barcodes/:barcodeId/primary')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Set a barcode as primary' })
  setPrimaryBarcode(@Param('id') id: string, @Param('barcodeId') barcodeId: string, @Request() req: any) {
    return this.productsService.setPrimaryBarcode(id, req.user.storeId, barcodeId);
  }

  @Delete(':id/barcodes/:barcodeId')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Remove a barcode' })
  removeBarcode(@Param('id') id: string, @Param('barcodeId') barcodeId: string, @Request() req: any) {
    return this.productsService.removeBarcode(id, req.user.storeId, barcodeId);
  }

  // ── Galerie d'images + documents (Lot 4, URLs externes) ──

  @Get(':id/media')
  @ApiOperation({ summary: 'List product image gallery (external URLs)' })
  listMedia(@Param('id') id: string, @Request() req: any) {
    return this.productsService.listMedia(id, req.user.storeId);
  }

  @Post(':id/media')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Add an image URL to the gallery' })
  addMedia(@Param('id') id: string, @Body() body: { url: string }, @Request() req: any) {
    return this.productsService.addMedia(id, req.user.storeId, body?.url ?? '');
  }

  @Delete(':id/media/:mediaId')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Remove an image from the gallery' })
  removeMedia(@Param('id') id: string, @Param('mediaId') mediaId: string, @Request() req: any) {
    return this.productsService.removeMedia(id, req.user.storeId, mediaId);
  }

  @Get(':id/documents')
  @ApiOperation({ summary: 'List product documents (external URLs)' })
  listDocuments(@Param('id') id: string, @Request() req: any) {
    return this.productsService.listDocuments(id, req.user.storeId);
  }

  @Post(':id/documents')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Add a document (name + URL)' })
  addDocument(@Param('id') id: string, @Body() body: { name: string; url: string }, @Request() req: any) {
    return this.productsService.addDocument(id, req.user.storeId, body?.name ?? '', body?.url ?? '');
  }

  @Delete(':id/documents/:documentId')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Remove a document' })
  removeDocument(@Param('id') id: string, @Param('documentId') documentId: string, @Request() req: any) {
    return this.productsService.removeDocument(id, req.user.storeId, documentId);
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

  @Get(':id/change-log')
  @ApiOperation({ summary: 'Full change log of the product sheet (fields, purchase price, supplier, status)' })
  changeLog(@Param('id') id: string, @Request() req: any) {
    return this.productsService.getChangeLog(id, req.user.storeId);
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
