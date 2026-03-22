import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductEntity } from '../../database/entities/product.entity';
import { PriceHistoryEntity } from '../../database/entities/price-history.entity';
import { AuditService } from '../audit/audit.service';
import { PaginatedResult } from '../../common/dto/pagination.dto';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(ProductEntity)
    private productRepo: Repository<ProductEntity>,
    @InjectRepository(PriceHistoryEntity)
    private priceHistoryRepo: Repository<PriceHistoryEntity>,
    private auditService: AuditService,
  ) {}

  async create(
    data: Partial<ProductEntity>,
    employeeId: string,
  ): Promise<ProductEntity> {
    const product = this.productRepo.create(data);
    const saved = await this.productRepo.save(product);

    await this.auditService.log({
      storeId: saved.storeId,
      employeeId,
      action: 'price_change',
      entityType: 'product',
      entityId: saved.id,
      details: { action: 'created', price: saved.priceMinorUnits },
    });

    return saved;
  }

  async findAll(
    storeId: string,
    options?: { page?: number; limit?: number; search?: string },
  ): Promise<PaginatedResult<ProductEntity>> {
    const page = options?.page || 1;
    const limit = options?.limit || 50;
    const skip = (page - 1) * limit;

    const qb = this.productRepo
      .createQueryBuilder('p')
      .where('p.store_id = :storeId', { storeId })
      .andWhere('p.is_active = true');

    if (options?.search) {
      qb.andWhere(
        '(p.name ILIKE :search OR p.ean ILIKE :search)',
        { search: `%${options.search}%` },
      );
    }

    qb.orderBy('p.name', 'ASC').skip(skip).take(limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findByEan(
    ean: string,
    storeId: string,
  ): Promise<ProductEntity | null> {
    return this.productRepo.findOne({
      where: { ean, storeId, isActive: true },
    });
  }

  async findOne(id: string, storeId?: string): Promise<ProductEntity> {
    const where: any = { id };
    if (storeId) where.storeId = storeId;
    const product = await this.productRepo.findOne({ where });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  /** Tenant-safe: throws if product does not belong to store */
  async findOneForStore(
    id: string,
    storeId: string,
  ): Promise<ProductEntity> {
    const product = await this.productRepo.findOne({
      where: { id, storeId },
    });
    if (!product) {
      throw new ForbiddenException(
        'Product not found or belongs to another store.',
      );
    }
    return product;
  }

  async update(
    id: string,
    data: Partial<ProductEntity>,
    employeeId: string,
    reason?: string,
    storeId?: string,
  ): Promise<ProductEntity> {
    const existing = storeId
      ? await this.findOneForStore(id, storeId)
      : await this.findOne(id);

    // Track price changes
    if (
      data.priceMinorUnits !== undefined &&
      data.priceMinorUnits !== existing.priceMinorUnits
    ) {
      await this.priceHistoryRepo.save({
        productId: id,
        oldPriceMinorUnits: existing.priceMinorUnits,
        newPriceMinorUnits: data.priceMinorUnits,
        changedBy: employeeId,
        reason: reason || 'Manual price update',
      });

      await this.auditService.log({
        storeId: existing.storeId,
        employeeId,
        action: 'price_change',
        entityType: 'product',
        entityId: id,
        details: {
          oldPrice: existing.priceMinorUnits,
          newPrice: data.priceMinorUnits,
          reason,
        },
      });
    }

    await this.productRepo.update(id, data);
    return this.findOne(id, storeId);
  }

  async updateStock(
    id: string,
    quantityDelta: number,
    storeId?: string,
  ): Promise<ProductEntity> {
    const product = storeId
      ? await this.findOneForStore(id, storeId)
      : await this.findOne(id);
    product.stockQuantity += quantityDelta;
    if (product.stockQuantity < 0) product.stockQuantity = 0;
    return this.productRepo.save(product);
  }

  async getCategories(storeId: string): Promise<string[]> {
    const result = await this.productRepo
      .createQueryBuilder('p')
      .select('DISTINCT p.category_id', 'category')
      .where('p.store_id = :storeId', { storeId })
      .andWhere('p.category_id IS NOT NULL')
      .orderBy('p.category_id')
      .getRawMany();
    return result.map((r) => r.category);
  }

  async getStockAlerts(storeId: string): Promise<{
    alert: ProductEntity[];
    critical: ProductEntity[];
  }> {
    const alert = await this.productRepo
      .createQueryBuilder('p')
      .where('p.store_id = :storeId', { storeId })
      .andWhere('p.is_active = true')
      .andWhere('p.stock_quantity <= p.stock_alert_threshold')
      .andWhere('p.stock_quantity > p.stock_critical_threshold')
      .orderBy('p.stock_quantity', 'ASC')
      .getMany();

    const critical = await this.productRepo
      .createQueryBuilder('p')
      .where('p.store_id = :storeId', { storeId })
      .andWhere('p.is_active = true')
      .andWhere('p.stock_quantity <= p.stock_critical_threshold')
      .orderBy('p.stock_quantity', 'ASC')
      .getMany();

    return { alert, critical };
  }

  async getPriceHistory(
    productId: string,
    storeId?: string,
  ): Promise<PriceHistoryEntity[]> {
    // Verify product belongs to store before returning history
    if (storeId) {
      await this.findOneForStore(productId, storeId);
    }
    return this.priceHistoryRepo.find({
      where: { productId },
      order: { changedAt: 'DESC' },
    });
  }

  /**
   * Generate an internal barcode (EAN-13 format with prefix 290)
   * for products that don't have a barcode from their supplier.
   */
  async generateBarcode(productId: string, storeId: string): Promise<ProductEntity> {
    const product = await this.findOneForStore(productId, storeId);

    // Don't overwrite imported barcodes
    if (product.barcodeSource === 'imported' && product.ean && !product.ean.startsWith('290')) {
      throw new BadRequestException(
        'Ce produit a déjà un code-barres fournisseur. Utilisez la modification manuelle pour le changer.',
      );
    }

    // Generate unique EAN-13 with prefix 290 (internal use)
    let ean: string;
    let attempts = 0;
    do {
      // 290 + 9 random digits + 1 check digit = 13 chars
      const random = String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, '0');
      const partial = `290${random}`;
      // EAN-13 check digit
      let sum = 0;
      for (let i = 0; i < 12; i++) {
        sum += parseInt(partial[i]) * (i % 2 === 0 ? 1 : 3);
      }
      const checkDigit = (10 - (sum % 10)) % 10;
      ean = `${partial}${checkDigit}`;

      // Verify uniqueness
      const existing = await this.productRepo.findOne({ where: { ean, storeId } });
      if (!existing || existing.id === productId) break;
      attempts++;
    } while (attempts < 10);

    if (attempts >= 10) {
      throw new BadRequestException('Impossible de générer un code-barres unique. Réessayez.');
    }

    product.ean = ean;
    product.barcodeSource = 'generated';
    return this.productRepo.save(product);
  }
}
