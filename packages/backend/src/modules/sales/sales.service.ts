import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { SaleEntity } from '../../database/entities/sale.entity';
import { SaleLineItemEntity } from '../../database/entities/sale-line-item.entity';
import { SalePaymentEntity } from '../../database/entities/sale-payment.entity';
import { ProductEntity } from '../../database/entities/product.entity';
import { ProductsService } from '../products/products.service';
import { CustomersService } from '../customers/customers.service';
import { PromotionsService, CartItem } from '../promotions/promotions.service';
import { AuditService } from '../audit/audit.service';
import { StockService } from '../stock/stock.service';
import { JackpotService, JackpotResult } from '../jackpot/jackpot.service';
import { PaginatedResult } from '../../common/dto/pagination.dto';

function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

interface CreateSaleDto {
  items: { ean: string; quantity: number }[];
  customerQrCode?: string;
  payments: { method: string; amountMinorUnits: number }[];
}

export interface SaleStockAlert {
  productId: string;
  productName: string;
  ean: string;
  remainingStock: number;
  level: 'alert' | 'critical' | 'out_of_stock';
  message: string;
}

@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);

  constructor(
    @InjectRepository(SaleEntity)
    private saleRepo: Repository<SaleEntity>,
    @InjectRepository(SaleLineItemEntity)
    private lineItemRepo: Repository<SaleLineItemEntity>,
    @InjectRepository(SalePaymentEntity)
    private paymentRepo: Repository<SalePaymentEntity>,
    private dataSource: DataSource,
    private productsService: ProductsService,
    private customersService: CustomersService,
    private promotionsService: PromotionsService,
    private auditService: AuditService,
    private stockService: StockService,
    private jackpotService: JackpotService,
  ) {}

  /**
   * Create a sale — the core POS transaction.
   *
   * P0 fixes applied:
   * - Entire flow wrapped in a DB transaction (atomicity)
   * - Ticket number uses SELECT ... FOR UPDATE (no race condition)
   * - Products resolved once, reused for stock decrement (no duplicate queries)
   */
  async createSale(
    storeId: string,
    employeeId: string,
    dto: CreateSaleDto,
  ): Promise<SaleEntity> {
    // --- Input validation ---
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Sale must have at least one item');
    }
    if (!dto.payments || dto.payments.length === 0) {
      throw new BadRequestException('Sale must have at least one payment');
    }

    // --- Pre-transaction: resolve products and customer (read-only) ---
    const resolvedProducts: Map<string, ProductEntity> = new Map();
    for (const item of dto.items) {
      if (resolvedProducts.has(item.ean)) continue;
      const product = await this.productsService.findByEan(item.ean, storeId);
      if (!product) {
        throw new BadRequestException(`Product not found: ${item.ean}`);
      }
      resolvedProducts.set(item.ean, product);
    }

    let customerId: string | undefined;
    let isFirstPurchase = false;
    if (dto.customerQrCode) {
      const customer = await this.customersService.findByQrCode(
        dto.customerQrCode,
        storeId,
      );
      if (customer) {
        customerId = customer.id;
        isFirstPurchase = customer.isFirstPurchase;
      }
    }

    // --- Compute promotions (read-only) ---
    const lineItems: SaleLineItemEntity[] = [];
    const cartItems: CartItem[] = [];
    let subtotal = 0;

    for (const item of dto.items) {
      const product = resolvedProducts.get(item.ean)!;
      const lineTotal = product.priceMinorUnits * item.quantity;
      subtotal += lineTotal;

      const lineItem = new SaleLineItemEntity();
      lineItem.id = uuidv4();
      lineItem.productId = product.id;
      lineItem.productName = product.name;
      lineItem.ean = product.ean;
      lineItem.quantity = item.quantity;
      lineItem.unitPriceMinorUnits = product.priceMinorUnits;
      lineItem.taxRate = product.taxRate;
      lineItem.discountMinorUnits = 0;
      lineItem.lineTotalMinorUnits = lineTotal;

      lineItems.push(lineItem);
      cartItems.push({
        productId: product.id,
        categoryId: product.categoryId,
        quantity: item.quantity,
        unitPriceMinorUnits: product.priceMinorUnits,
      });
    }

    const promoResults = await this.promotionsService.applyPromos(
      storeId,
      cartItems,
      isFirstPurchase,
    );
    let totalDiscount = 0;

    for (const promo of promoResults) {
      const lineItem = lineItems.find(
        (li) => li.productId === promo.productId,
      );
      if (lineItem) {
        lineItem.discountMinorUnits += promo.discountMinorUnits;
        lineItem.promoId = promo.promoId;
        lineItem.lineTotalMinorUnits =
          lineItem.unitPriceMinorUnits * lineItem.quantity -
          lineItem.discountMinorUnits;
        totalDiscount += promo.discountMinorUnits;
      }
    }

    // Calculate totals
    const totalAfterDiscount = subtotal - totalDiscount;
    let taxTotal = 0;
    for (const li of lineItems) {
      // Extract tax from gross (TTC → TVA component)
      const taxAmount = Math.round(
        li.lineTotalMinorUnits * (li.taxRate / (100 + li.taxRate)),
      );
      taxTotal += taxAmount;
    }

    // Validate payments cover the total
    const paymentTotal = dto.payments.reduce(
      (sum, p) => sum + p.amountMinorUnits,
      0,
    );
    if (paymentTotal < totalAfterDiscount) {
      throw new BadRequestException(
        `Payment total ${paymentTotal} < sale total ${totalAfterDiscount}`,
      );
    }

    // =====================================================================
    // TRANSACTION BOUNDARY — everything below is atomic
    // =====================================================================
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction('SERIALIZABLE');

    try {
      // --- Ticket number with row-level locking (no race condition) ---
      // Uses a raw query with FOR UPDATE to lock the last sale row
      const lastSaleResult = await queryRunner.query(
        `SELECT ticket_number FROM sales
         WHERE store_id = $1
         ORDER BY created_at DESC
         LIMIT 1
         FOR UPDATE`,
        [storeId],
      );
      const lastTicketNum =
        lastSaleResult.length > 0
          ? parseInt(lastSaleResult[0].ticket_number.split('-')[1] || '0')
          : 0;
      const ticketNumber = `T-${String(lastTicketNum + 1).padStart(6, '0')}`;

      // --- Hash chain ---
      const prevHashResult = await queryRunner.query(
        `SELECT hash_chain_current FROM sales
         WHERE store_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [storeId],
      );
      const prevHash =
        prevHashResult.length > 0
          ? prevHashResult[0].hash_chain_current
          : '0000000000000000000000000000000000000000000000000000000000000000';

      const saleDataForHash = JSON.stringify({
        ticketNumber,
        storeId,
        employeeId,
        totalAfterDiscount,
        items: lineItems.map((li) => ({
          ean: li.ean,
          qty: li.quantity,
          total: li.lineTotalMinorUnits,
        })),
      });
      const currentHash = sha256(prevHash + saleDataForHash);

      // --- Build sale entity ---
      const sale = new SaleEntity();
      sale.id = uuidv4();
      sale.storeId = storeId;
      sale.employeeId = employeeId;
      sale.customerId = customerId ?? (null as any);
      sale.status = 'completed';
      sale.subtotalMinorUnits = subtotal;
      sale.discountTotalMinorUnits = totalDiscount;
      sale.taxTotalMinorUnits = taxTotal;
      sale.totalMinorUnits = totalAfterDiscount;
      sale.currencyCode = 'EUR';
      sale.ticketNumber = ticketNumber;
      sale.hashChainPrev = prevHash;
      sale.hashChainCurrent = currentHash;
      sale.completedAt = new Date();

      for (const li of lineItems) {
        li.saleId = sale.id;
      }
      sale.lineItems = lineItems;

      sale.payments = dto.payments.map((p) => {
        const payment = new SalePaymentEntity();
        payment.id = uuidv4();
        payment.saleId = sale.id;
        payment.method = p.method;
        payment.amountMinorUnits = p.amountMinorUnits;
        payment.currencyCode = 'EUR';
        return payment;
      });

      // --- Save sale (cascade saves lineItems + payments) ---
      const saved = await queryRunner.manager.save(SaleEntity, sale);

      // --- Decrement stock atomically within transaction ---
      for (const item of dto.items) {
        const product = resolvedProducts.get(item.ean)!;
        await queryRunner.query(
          `UPDATE products
           SET stock_quantity = GREATEST(0, stock_quantity - $1),
               updated_at = NOW()
           WHERE id = $2 AND store_id = $3`,
          [item.quantity, product.id, storeId],
        );
      }

      // --- Mark first purchase used ---
      if (
        customerId &&
        isFirstPurchase &&
        promoResults.some((r) => r.type === 'first_purchase')
      ) {
        await queryRunner.query(
          `UPDATE customers SET is_first_purchase = false, updated_at = NOW() WHERE id = $1 AND store_id = $2`,
          [customerId, storeId],
        );
      }

      // --- Add loyalty points ---
      if (customerId) {
        const pointsEarned = Math.floor(totalAfterDiscount / 100);
        if (pointsEarned > 0) {
          await queryRunner.query(
            `UPDATE customers
             SET loyalty_points = loyalty_points + $1, updated_at = NOW()
             WHERE id = $2 AND store_id = $3`,
            [pointsEarned, customerId, storeId],
          );
        }
      }

      // --- COMMIT ---
      await queryRunner.commitTransaction();

      // --- Post-transaction side effects (non-critical) ---
      // Audit log
      try {
        await this.auditService.log({
          storeId,
          employeeId,
          action: 'sale_completed',
          entityType: 'sale',
          entityId: saved.id,
          details: {
            ticketNumber,
            total: totalAfterDiscount,
            itemCount: lineItems.length,
            discount: totalDiscount,
            hash: currentHash,
          },
        });
      } catch (auditErr: any) {
        this.logger.warn(`Audit log failed: ${auditErr?.message}`);
      }

      // Peripheral events (physical drivers in V1)
      if (dto.payments.some((p) => p.method === 'cash')) {
        this.logger.log(`[PERIPHERAL] Cash drawer opened for ${ticketNumber}`);
      }
      this.logger.log(`[PERIPHERAL] Printing ticket ${ticketNumber}`);
      this.printTicketMock(saved);

      // Stock alerts — compute synchronously to include in response
      const stockAlerts = this.computeStockAlerts(resolvedProducts, dto.items);

      // Log stock alerts asynchronously (fire-and-forget)
      this.logStockAlertsAsync(storeId, employeeId, stockAlerts, resolvedProducts);

      // Jackpot lottery roll (fire-and-forget — NEVER blocks the sale)
      let jackpotResult: JackpotResult | null = null;
      try {
        jackpotResult = await this.jackpotService.rollLottery(storeId, saved.id);
      } catch (jackpotErr: any) {
        this.logger.warn(`Jackpot roll failed (non-blocking): ${jackpotErr?.message}`);
      }

      // Attach jackpot result + stock alerts to the sale response
      return { ...saved, jackpotResult, stockAlerts } as SaleEntity & { jackpotResult: JackpotResult | null; stockAlerts: SaleStockAlert[] };
    } catch (error: any) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `Sale creation failed, transaction rolled back: ${error?.message}`,
        error?.stack,
      );
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Compute stock alerts synchronously (pure logic, no I/O).
   * Returns alerts for products that crossed thresholds after this sale.
   */
  private computeStockAlerts(
    products: Map<string, ProductEntity>,
    items: { ean: string; quantity: number }[],
  ): SaleStockAlert[] {
    const alerts: SaleStockAlert[] = [];

    for (const item of items) {
      const product = products.get(item.ean);
      if (!product) continue;
      const newQty = Math.max(0, product.stockQuantity - item.quantity);

      if (newQty <= 0) {
        alerts.push({
          productId: product.id,
          productName: product.name,
          ean: product.ean,
          remainingStock: 0,
          level: 'out_of_stock',
          message: `${product.name} est en rupture de stock !`,
        });
      } else if (newQty <= product.stockCriticalThreshold) {
        alerts.push({
          productId: product.id,
          productName: product.name,
          ean: product.ean,
          remainingStock: newQty,
          level: 'critical',
          message: `${product.name}: stock critique (${newQty} restant${newQty > 1 ? 's' : ''})`,
        });
      } else if (newQty <= product.stockAlertThreshold) {
        alerts.push({
          productId: product.id,
          productName: product.name,
          ean: product.ean,
          remainingStock: newQty,
          level: 'alert',
          message: `${product.name}: stock bas (${newQty} restant${newQty > 1 ? 's' : ''})`,
        });
      }
    }

    return alerts;
  }

  /**
   * Log stock alerts to audit (fire-and-forget, outside transaction).
   */
  private async logStockAlertsAsync(
    storeId: string,
    employeeId: string,
    alerts: SaleStockAlert[],
    products: Map<string, ProductEntity>,
  ): Promise<void> {
    try {
      for (const alert of alerts) {
        const product = [...products.values()].find((p) => p.id === alert.productId);
        this.logger.warn(
          `${alert.level.toUpperCase()} STOCK: ${alert.productName} (${alert.ean}) ~ ${alert.remainingStock} units`,
        );
        await this.auditService.log({
          storeId,
          employeeId,
          action: 'stock_adjustment',
          entityType: 'product',
          entityId: alert.productId,
          details: {
            level: alert.level,
            productName: alert.productName,
            ean: alert.ean,
            estimatedQuantity: alert.remainingStock,
            threshold:
              alert.level === 'critical' || alert.level === 'out_of_stock'
                ? product?.stockCriticalThreshold
                : product?.stockAlertThreshold,
          },
        });
      }
    } catch (err: any) {
      this.logger.warn(`Stock alert logging failed: ${err?.message}`);
    }
  }

  async findOne(id: string, storeId: string): Promise<SaleEntity> {
    const sale = await this.saleRepo.findOne({
      where: { id, storeId },
      relations: ['lineItems', 'payments'],
    });
    if (!sale) throw new NotFoundException('Sale not found');
    return sale;
  }

  async findByStore(
    storeId: string,
    options?: { page?: number; limit?: number; date?: string },
  ): Promise<PaginatedResult<SaleEntity>> {
    const page = options?.page || 1;
    const limit = options?.limit || 50;
    const skip = (page - 1) * limit;

    const qb = this.saleRepo
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.lineItems', 'li')
      .leftJoinAndSelect('s.payments', 'p')
      .where('s.store_id = :storeId', { storeId })
      .orderBy('s.created_at', 'DESC');

    if (options?.date) {
      qb.andWhere('DATE(s.created_at) = :date', { date: options.date });
    }

    qb.skip(skip).take(limit);

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

  async voidSale(
    id: string,
    employeeId: string,
    storeId: string,
  ): Promise<SaleEntity> {
    const sale = await this.findOne(id, storeId);
    if (sale.status === 'voided') {
      throw new BadRequestException('Sale already voided');
    }

    // Void within transaction
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      sale.status = 'voided';
      const saved = await queryRunner.manager.save(SaleEntity, sale);

      // Restore stock atomically
      for (const item of sale.lineItems) {
        await queryRunner.query(
          `UPDATE products
           SET stock_quantity = stock_quantity + $1, updated_at = NOW()
           WHERE id = $2 AND store_id = $3`,
          [item.quantity, item.productId, storeId],
        );
      }

      await queryRunner.commitTransaction();

      // Audit (post-transaction)
      await this.auditService.log({
        storeId: sale.storeId,
        employeeId,
        action: 'sale_voided',
        entityType: 'sale',
        entityId: id,
        details: {
          ticketNumber: sale.ticketNumber,
          total: sale.totalMinorUnits,
        },
      });

      return saved;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private printTicketMock(sale: SaleEntity): void {
    const lines = [
      '========================================',
      '              CAISSE POS',
      '========================================',
      `Ticket: ${sale.ticketNumber}`,
      `Date: ${sale.completedAt?.toISOString() || new Date().toISOString()}`,
      '----------------------------------------',
    ];

    for (const item of sale.lineItems) {
      const price = (item.lineTotalMinorUnits / 100).toFixed(2);
      lines.push(`${item.productName} x${item.quantity}  ${price} EUR`);
      if (item.discountMinorUnits > 0) {
        lines.push(
          `  Remise: -${(item.discountMinorUnits / 100).toFixed(2)} EUR`,
        );
      }
    }

    lines.push('----------------------------------------');
    if (sale.discountTotalMinorUnits > 0) {
      lines.push(
        `Sous-total: ${(sale.subtotalMinorUnits / 100).toFixed(2)} EUR`,
      );
      lines.push(
        `Remise totale: -${(sale.discountTotalMinorUnits / 100).toFixed(2)} EUR`,
      );
    }
    lines.push(
      `TOTAL: ${(sale.totalMinorUnits / 100).toFixed(2)} EUR`,
    );
    lines.push(
      `TVA: ${(sale.taxTotalMinorUnits / 100).toFixed(2)} EUR`,
    );
    lines.push('----------------------------------------');

    for (const payment of sale.payments) {
      lines.push(
        `${payment.method.toUpperCase()}: ${(payment.amountMinorUnits / 100).toFixed(2)} EUR`,
      );
    }

    lines.push('========================================');
    lines.push(`Hash: ${sale.hashChainCurrent?.slice(0, 16)}...`);
    lines.push('       Merci de votre visite !');
    lines.push('========================================');

    console.log('\n' + lines.join('\n') + '\n');
  }
}
