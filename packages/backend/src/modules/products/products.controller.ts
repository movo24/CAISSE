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

  /**
   * Contexte magasin d'un endpoint PRODUIT (:id) : un ADMIN opère sur la fiche
   * dans le magasin RÉEL du produit — il peut cibler n'importe quel magasin à
   * la création, l'édition doit donc suivre le produit, pas le magasin du JWT
   * (sinon « Product not found or belongs to another store » sur une fiche
   * légitime — bug The Wesley Test 2026-07-23). Tout autre rôle reste
   * strictement sur son magasin : l'isolation tenant est inchangée.
   */
  private async storeCtxFor(req: any, productId: string): Promise<string> {
    if (req.user.role !== 'admin') return req.user.storeId;
    const productStore = await this.productsService.storeIdOfProduct(productId);
    return productStore ?? req.user.storeId;
  }

  @Post()
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Create a product (admin may target a specific store)' })
  create(@Body() dto: CreateProductDto, @Request() req: any) {
    // Affectation magasin : un ADMIN peut cibler explicitement un magasin
    // (étape « Magasin & publication » de la fiche). Sans cible explicite —
    // et pour tout autre rôle (TenantInterceptor bloque en amont un
    // body.storeId étranger) — le magasin du JWT reste forcé : un produit
    // n'est JAMAIS créé sans rattachement contrôlé.
    const targetStoreId =
      req.user.role === 'admin' && dto.storeId ? dto.storeId : req.user.storeId;
    return this.productsService.create(
      { ...dto, storeId: targetStoreId },
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
  async findOne(@Param('id') id: string, @Request() req: any) {
    return this.productsService.findOneForStore(id, await this.storeCtxFor(req, id));
  }

  // ── Variants / SKU (decision 5) ──

  @Get(':id/variants')
  @ApiOperation({ summary: 'List the variants of a product' })
  async listVariants(@Param('id') id: string, @Request() req: any) {
    return this.productsService.listVariants(id, await this.storeCtxFor(req, id));
  }

  @Post(':id/variants')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Create a variant (own ean/sku/price/stock) under a product' })
  async createVariant(
    @Param('id') id: string,
    @Body() body: { ean: string; variantName: string; priceMinorUnits: number; sku?: string; stockQuantity?: number; taxRate?: number; costMinorUnits?: number },
    @Request() req: any,
  ) {
    return this.productsService.createVariant(id, await this.storeCtxFor(req, id), body, req.user.employeeId);
  }

  @Post(':id/variants/generate')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Generate variants from attributes (cartesian product, e.g. size × color)' })
  async generateVariants(
    @Param('id') id: string,
    @Body() body: { attributes: Array<{ name: string; values: string[] }>; priceMinorUnits?: number },
    @Request() req: any,
  ) {
    return this.productsService.generateVariants(id, await this.storeCtxFor(req, id), body?.attributes ?? [], req.user.employeeId, {
      priceMinorUnits: body?.priceMinorUnits,
    });
  }

  // ── Product Packs — composition d'un produit composé (GO owner 2026-07-09) ──

  @Get(':id/components')
  @ApiOperation({ summary: 'List the pack components of a product (parent = billed product)' })
  async listComponents(@Param('id') id: string, @Request() req: any) {
    return this.productsService.listComponents(id, await this.storeCtxFor(req, id));
  }

  @Post(':id/components')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Add a component to a pack (loop-safe, unique per parent+component)' })
  async addComponent(
    @Param('id') id: string,
    @Body() body: { componentProductId: string; quantityPerParent: number },
    @Request() req: any,
  ) {
    return this.productsService.addComponent(id, await this.storeCtxFor(req, id), body);
  }

  @Put(':id/components/:componentRowId')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Update quantity and/or active flag of a pack component' })
  async updateComponent(
    @Param('id') id: string,
    @Param('componentRowId') componentRowId: string,
    @Body() body: { quantityPerParent?: number; isActive?: boolean },
    @Request() req: any,
  ) {
    return this.productsService.updateComponent(id, componentRowId, await this.storeCtxFor(req, id), body);
  }

  @Delete(':id/components/:componentRowId')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Remove a component from the CURRENT composition (sale history keeps its snapshot)' })
  async removeComponent(
    @Param('id') id: string,
    @Param('componentRowId') componentRowId: string,
    @Request() req: any,
  ) {
    return this.productsService.removeComponent(id, componentRowId, await this.storeCtxFor(req, id));
  }

  // ── Produits liés (Lot E) ──

  @Get(':id/links')
  @ApiOperation({ summary: 'List related/cross-sell/substitute products' })
  async listLinks(@Param('id') id: string, @Request() req: any) {
    return this.productsService.listLinks(id, await this.storeCtxFor(req, id));
  }

  @Post(':id/links')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Link a product (complementary | cross_sell | substitute)' })
  async addLink(@Param('id') id: string, @Body() body: { linkedProductId: string; linkType?: string }, @Request() req: any) {
    return this.productsService.addLink(id, await this.storeCtxFor(req, id), body?.linkedProductId ?? '', body?.linkType);
  }

  @Delete(':id/links/:linkId')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Remove a product link' })
  async removeLink(@Param('id') id: string, @Param('linkId') linkId: string, @Request() req: any) {
    return this.productsService.removeLink(id, await this.storeCtxFor(req, id), linkId);
  }

  // ── Fournisseurs multiples (Lot B) ──

  @Get(':id/suppliers')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'List the suppliers of a product (with purchase conditions)' })
  async listProductSuppliers(@Param('id') id: string, @Request() req: any) {
    return this.productsService.listProductSuppliers(id, await this.storeCtxFor(req, id));
  }

  @Post(':id/suppliers')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Attach a supplier with purchase conditions' })
  async addProductSupplier(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.productsService.addProductSupplier(id, await this.storeCtxFor(req, id), body ?? {});
  }

  @Put(':id/suppliers/:rowId')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Update a product-supplier line' })
  async updateProductSupplier(@Param('id') id: string, @Param('rowId') rowId: string, @Body() body: any, @Request() req: any) {
    return this.productsService.updateProductSupplier(id, await this.storeCtxFor(req, id), rowId, body ?? {});
  }

  @Delete(':id/suppliers/:rowId')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Detach a supplier from the product' })
  async removeProductSupplier(@Param('id') id: string, @Param('rowId') rowId: string, @Request() req: any) {
    return this.productsService.removeProductSupplier(id, await this.storeCtxFor(req, id), rowId);
  }

  // ── Codes-barres multiples (Lot A) ──

  @Get(':id/barcodes')
  @ApiOperation({ summary: 'List additional barcodes of a product' })
  async listBarcodes(@Param('id') id: string, @Request() req: any) {
    return this.productsService.listBarcodes(id, await this.storeCtxFor(req, id));
  }

  @Post(':id/barcodes')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Add a barcode (EAN/UPC/GTIN); unique per store' })
  async addBarcode(
    @Param('id') id: string,
    @Body() body: { barcode: string; type?: string; isPrimary?: boolean },
    @Request() req: any,
  ) {
    return this.productsService.addBarcode(id, await this.storeCtxFor(req, id), body?.barcode ?? '', body?.type, body?.isPrimary);
  }

  @Put(':id/barcodes/:barcodeId/primary')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Set a barcode as primary' })
  async setPrimaryBarcode(@Param('id') id: string, @Param('barcodeId') barcodeId: string, @Request() req: any) {
    return this.productsService.setPrimaryBarcode(id, await this.storeCtxFor(req, id), barcodeId);
  }

  @Delete(':id/barcodes/:barcodeId')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Remove a barcode' })
  async removeBarcode(@Param('id') id: string, @Param('barcodeId') barcodeId: string, @Request() req: any) {
    return this.productsService.removeBarcode(id, await this.storeCtxFor(req, id), barcodeId);
  }

  // ── Galerie d'images + documents (Lot 4, URLs externes) ──

  @Get(':id/media')
  @ApiOperation({ summary: 'List product image gallery (external URLs)' })
  async listMedia(@Param('id') id: string, @Request() req: any) {
    return this.productsService.listMedia(id, await this.storeCtxFor(req, id));
  }

  @Post(':id/media')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Add an image URL to the gallery' })
  async addMedia(@Param('id') id: string, @Body() body: { url: string }, @Request() req: any) {
    return this.productsService.addMedia(id, await this.storeCtxFor(req, id), body?.url ?? '');
  }

  @Delete(':id/media/:mediaId')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Remove an image from the gallery' })
  async removeMedia(@Param('id') id: string, @Param('mediaId') mediaId: string, @Request() req: any) {
    return this.productsService.removeMedia(id, await this.storeCtxFor(req, id), mediaId);
  }

  @Put(':id/media/reorder')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Reorder the gallery (drag & drop) — pass ordered media ids' })
  async reorderMedia(@Param('id') id: string, @Body() body: { orderedIds: string[] }, @Request() req: any) {
    return this.productsService.reorderMedia(id, await this.storeCtxFor(req, id), body?.orderedIds ?? []);
  }

  @Get(':id/documents')
  @ApiOperation({ summary: 'List product documents (external URLs)' })
  async listDocuments(@Param('id') id: string, @Request() req: any) {
    return this.productsService.listDocuments(id, await this.storeCtxFor(req, id));
  }

  @Post(':id/documents')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Add a document (name + URL)' })
  async addDocument(@Param('id') id: string, @Body() body: { name: string; url: string }, @Request() req: any) {
    return this.productsService.addDocument(id, await this.storeCtxFor(req, id), body?.name ?? '', body?.url ?? '');
  }

  @Delete(':id/documents/:documentId')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Remove a document' })
  async removeDocument(@Param('id') id: string, @Param('documentId') documentId: string, @Request() req: any) {
    return this.productsService.removeDocument(id, await this.storeCtxFor(req, id), documentId);
  }

  // ── Per-store price override (decision 4) ──

  @Get(':id/store-price')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Get the per-store price override for a product (if any)' })
  async getStorePrice(@Param('id') id: string, @Request() req: any) {
    return this.productsService.getStoreOverride(await this.storeCtxFor(req, id), id);
  }

  @Put(':id/store-price')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Set the per-store price override (wins over base at sale; historised)' })
  async setStorePrice(
    @Param('id') id: string,
    @Body() body: { priceMinorUnits: number; startsAt?: string; endsAt?: string },
    @Request() req: any,
  ) {
    return this.productsService.setStoreOverride(
      await this.storeCtxFor(req, id),
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
  async clearStorePrice(@Param('id') id: string, @Request() req: any) {
    return this.productsService.clearStoreOverride(await this.storeCtxFor(req, id), id, req.user.employeeId, req.user.role);
  }

  @Get(':id/price-history')
  @ApiOperation({ summary: 'Get price change history' })
  async priceHistory(@Param('id') id: string, @Request() req: any) {
    return this.productsService.getPriceHistory(id, await this.storeCtxFor(req, id));
  }

  @Get(':id/change-log')
  @ApiOperation({ summary: 'Full change log of the product sheet (fields, purchase price, supplier, status)' })
  async changeLog(@Param('id') id: string, @Request() req: any) {
    return this.productsService.getChangeLog(id, await this.storeCtxFor(req, id));
  }

  @Get(':id/price-analytics')
  @ApiOperation({ summary: 'Get price analytics with sales impact per period' })
  async priceAnalytics(@Param('id') id: string, @Request() req: any) {
    return this.productsService.getPriceAnalytics(id, await this.storeCtxFor(req, id));
  }

  @Put(':id')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Update a product' })
  async update(@Param('id') id: string, @Body() dto: UpdateProductDto, @Request() req: any) {
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
      await this.storeCtxFor(req, id),
      changeSource,
      req.user.role,
    );
  }

  @Post(':id/duplicate')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Full duplicate: clone the sheet + packs/media/documents/suppliers/links (new internal EAN, draft)' })
  async duplicateProduct(@Param('id') id: string, @Request() req: any) {
    return this.productsService.duplicateProduct(id, await this.storeCtxFor(req, id), req.user.employeeId);
  }

  @Post(':id/generate-barcode')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Generate internal barcode for a product without one' })
  async generateBarcode(@Param('id') id: string, @Request() req: any) {
    return this.productsService.generateBarcode(id, await this.storeCtxFor(req, id));
  }

  @Delete(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Soft-delete a product (deactivate)' })
  async remove(@Param('id') id: string, @Request() req: any) {
    return this.productsService.deactivate(id, await this.storeCtxFor(req, id));
  }
}
