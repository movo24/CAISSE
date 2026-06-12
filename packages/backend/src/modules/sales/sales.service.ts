import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, QueryRunner } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { SaleEntity } from '../../database/entities/sale.entity';
import { SaleLineItemEntity } from '../../database/entities/sale-line-item.entity';
import { SalePaymentEntity } from '../../database/entities/sale-payment.entity';
import { IdempotencyKeyEntity } from '../../database/entities/idempotency-key.entity';
import { ProductEntity } from '../../database/entities/product.entity';
import { FiscalJournalEntity } from '../../database/entities/fiscal-journal.entity';
import { ProductsService } from '../products/products.service';
import { CustomersService } from '../customers/customers.service';
import { PromotionsService, CartItem } from '../promotions/promotions.service';
import { AuditService } from '../audit/audit.service';
import { StockService } from '../stock/stock.service';
import { JackpotService, JackpotResult } from '../jackpot/jackpot.service';
import { TimewinService } from '../timewin/timewin.service';
import { PaginatedResult } from '../../common/dto/pagination.dto';
import { logBusinessEvent } from '../../common/business-logger';
import { RealtimeService } from '../../common/realtime/realtime.service';

function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

interface CreateSaleDto {
  items: { ean: string; quantity: number }[];
  customerQrCode?: string;
  payments: {
    method: string;
    amountMinorUnits: number;
    stripePaymentIntentId?: string;
    /** Required when method === 'store_credit': the avoir code to redeem. */
    creditNoteCode?: string;
  }[];
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
    @InjectRepository(IdempotencyKeyEntity)
    private idempotencyRepo: Repository<IdempotencyKeyEntity>,
    private dataSource: DataSource,
    private productsService: ProductsService,
    private customersService: CustomersService,
    private promotionsService: PromotionsService,
    private auditService: AuditService,
    private stockService: StockService,
    private jackpotService: JackpotService,
    private timewinService: TimewinService,
    private realtime: RealtimeService,
  ) {}

  /** Serialize an entity to a plain JSON object for jsonb storage (dates → ISO strings). */
  private toJsonBody(entity: unknown): Record<string, unknown> {
    return JSON.parse(JSON.stringify(entity));
  }

  /**
   * Redeem any `store_credit` payments against their avoir, atomically within the
   * sale transaction: lock the credit note FOR UPDATE, validate the balance,
   * decrement it, record a redemption row. Throws (→ rollback) on any problem so
   * a sale can never consume more than an avoir holds.
   */
  async applyStoreCreditRedemptions(
    qr: QueryRunner,
    storeId: string,
    saleId: string,
    payments: { method: string; amountMinorUnits: number; creditNoteCode?: string }[],
  ): Promise<void> {
    for (const p of payments) {
      if (p.method !== 'store_credit') continue;
      if (!p.creditNoteCode) {
        throw new BadRequestException('creditNoteCode requis pour un paiement par avoir');
      }
      const rows = await qr.query(
        `SELECT id, remaining_minor_units, status, type FROM credit_notes
          WHERE code = $1 AND store_id = $2 FOR UPDATE`,
        [p.creditNoteCode, storeId],
      );
      if (rows.length === 0) throw new BadRequestException(`Avoir introuvable: ${p.creditNoteCode}`);
      const cn = rows[0];
      if (cn.type !== 'store_credit') throw new BadRequestException("Cet avoir n'est pas utilisable en caisse");
      if (cn.status === 'redeemed' || cn.status === 'cancelled') {
        throw new BadRequestException('Avoir déjà utilisé ou annulé');
      }
      if (p.amountMinorUnits <= 0 || p.amountMinorUnits > cn.remaining_minor_units) {
        throw new BadRequestException("Solde de l'avoir insuffisant");
      }
      const newRemaining = cn.remaining_minor_units - p.amountMinorUnits;
      const newStatus = newRemaining === 0 ? 'redeemed' : 'partially_redeemed';
      await qr.query(`UPDATE credit_notes SET remaining_minor_units = $1, status = $2 WHERE id = $3`, [
        newRemaining,
        newStatus,
        cn.id,
      ]);
      await qr.query(
        `INSERT INTO credit_note_redemptions (id, credit_note_id, sale_id, store_id, amount_minor_units, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [uuidv4(), cn.id, saleId, storeId, p.amountMinorUnits],
      );
    }
  }

  /** Idempotency keys live 7 days — long enough to cover extended offline sync replays. */
  private idempotencyExpiry(): Date {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d;
  }

  /**
   * Validate/normalize an incoming idempotency key. Returns undefined when absent
   * (idempotency is opt-in for backward compatibility). The PK column is 64 chars.
   */
  private normalizeIdempotencyKey(key?: string): string | undefined {
    if (!key) return undefined;
    const trimmed = key.trim();
    if (!trimmed) return undefined;
    if (trimmed.length > 64) {
      throw new BadRequestException('Idempotency-Key too long (max 64 chars)');
    }
    return trimmed;
  }

  /** Build the createSale replay response from a cached idempotency record. */
  private replaySaleResponse(
    cached: IdempotencyKeyEntity,
  ): SaleEntity & { jackpotResult: JackpotResult | null; stockAlerts: SaleStockAlert[] } {
    return {
      ...(cached.responseBody as unknown as SaleEntity),
      jackpotResult: null,
      stockAlerts: [],
    };
  }

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
    employeeSnapshot?: { employeeName?: string; employeeRole?: string; maxDiscount?: number },
    idempotencyKey?: string,
  ): Promise<SaleEntity> {
    // --- Idempotency (NF525): a replayed offline-sync POST must NEVER create a
    // second sale. Fast path BEFORE validation so a replay does not falsely fail
    // on "insufficient stock" if the catalogue moved on since the original sale.
    const idemKey = this.normalizeIdempotencyKey(idempotencyKey);
    if (idemKey) {
      const cached = await this.idempotencyRepo.findOne({ where: { key: idemKey } });
      if (cached) {
        this.logger.log(`[IDEMPOTENT] /sales replay for key ${idemKey} — returning cached sale`);
        return this.replaySaleResponse(cached);
      }
    }

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

    // --- Pre-transaction: validate stock availability ---
    const requestedQty: Map<string, number> = new Map();
    for (const item of dto.items) {
      requestedQty.set(
        item.ean,
        (requestedQty.get(item.ean) || 0) + item.quantity,
      );
    }
    for (const [ean, qty] of requestedQty) {
      const product = resolvedProducts.get(ean)!;
      if (product.stockQuantity < qty) {
        throw new BadRequestException(
          `Insufficient stock for ${product.name} (${ean}): ` +
            `${qty} requested, ${product.stockQuantity} available`,
        );
      }
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

    // --- Enforce maxDiscount limit ---
    const maxDiscountPct = employeeSnapshot?.maxDiscount ?? 100;
    if (maxDiscountPct < 100 && subtotal > 0) {
      const maxAllowedDiscount = Math.floor(subtotal * (maxDiscountPct / 100));
      if (totalDiscount > maxAllowedDiscount) {
        throw new BadRequestException(
          `Discount ${totalDiscount} exceeds employee limit of ${maxDiscountPct}% (max ${maxAllowedDiscount} on subtotal ${subtotal})`,
        );
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

    // --- M1: an avoir (store_credit) can only cover the RESIDUAL due, never more.
    // Never trust the client's split: cap server-side so a sale can never debit an
    // avoir beyond what cash/card/other tenders left to pay (no value destruction). ---
    const storeCreditRequested = dto.payments
      .filter((p) => p.method === 'store_credit')
      .reduce((sum, p) => sum + p.amountMinorUnits, 0);
    const nonStoreCreditPaid = paymentTotal - storeCreditRequested;
    const storeCreditAllowed = Math.max(0, totalAfterDiscount - nonStoreCreditPaid);
    if (storeCreditRequested > storeCreditAllowed) {
      throw new BadRequestException(
        `Montant d'avoir (${storeCreditRequested}) dépasse le reste dû (${storeCreditAllowed})`,
      );
    }

    // =====================================================================
    // TRANSACTION BOUNDARY — everything below is atomic
    // Retry up to 3 times on serialization/unique constraint failures
    // =====================================================================
    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // --- Idempotency re-check inside the transaction (handles concurrent
      // duplicates that both passed the pre-transaction fast path) ---
      if (idemKey) {
        const cachedInTx = await queryRunner.manager.findOne(IdempotencyKeyEntity, {
          where: { key: idemKey },
        });
        if (cachedInTx) {
          await queryRunner.commitTransaction();
          return this.replaySaleResponse(cachedInTx);
        }
      }

      // --- Ticket number: atomic increment using store row lock ---
      // Lock the store row to serialize ticket number generation
      await queryRunner.query(
        `SELECT id FROM stores WHERE id = $1 FOR UPDATE`,
        [storeId],
      );

      // --- Ticket number from the monotonic integer cursor (sale_seq), NOT from
      // lexical ordering of the padded ticket string. `ORDER BY ticket_number
      // DESC` is text ordering: it equals numeric order only to 6 digits, so at
      // the 1,000,000th sale `T-1000000` sorts before `T-999999` → the generator
      // recomputes 1000000 (DUPLICATE ticket) and the chain head below reads the
      // wrong row (chain FORK). MAX(sale_seq) is numeric and correct at any scale.
      // sale_seq is the cursor ADR-012 keys the Z-seal close-window on. ---
      const nextSeqResult = await queryRunner.query(
        `SELECT COALESCE(MAX(sale_seq), 0) + 1 AS next_seq
           FROM sales WHERE store_id = $1`,
        [storeId],
      );
      const saleSeq = Number(nextSeqResult[0].next_seq);
      const ticketNumber = `T-${String(saleSeq).padStart(6, '0')}`;

      // --- Hash chain head: the row with the greatest sale_seq for this store.
      // Ordered by the SAME integer cursor as the generator (never the lexical
      // ticket string) so the chain links to the true predecessor past 1,000,000.
      // `sale_seq IS NOT NULL` skips offline-synced sales (client ticket, no seq),
      // which are not part of the online fiscal chain. ---
      const prevHashResult = await queryRunner.query(
        `SELECT hash_chain_current FROM sales
         WHERE store_id = $1 AND sale_seq IS NOT NULL
         ORDER BY sale_seq DESC
         LIMIT 1`,
        [storeId],
      );
      const prevHash =
        prevHashResult.length > 0
          ? prevHashResult[0].hash_chain_current
          : '0000000000000000000000000000000000000000000000000000000000000000';

      // --- M2: hash fingerprint v2. v1 covered only {ticketNumber, storeId,
      // employeeId, total, items}, leaving TVA, remise, paiements, horodatage and
      // client alterable WITHOUT breaking the chain. v2 binds every fiscal field.
      // Existing v1 rows are NEVER rehashed (immutability); `hashVersion` records
      // which formula a row used so a verifier can pick the right one. The
      // timestamp is computed here so the exact value is what gets hashed. ---
      const completedAt = new Date();
      const saleDataForHash = JSON.stringify({
        v: 2,
        ticketNumber,
        storeId,
        employeeId,
        customerId: customerId ?? null,
        subtotalMinorUnits: subtotal,
        discountTotalMinorUnits: totalDiscount,
        taxTotalMinorUnits: taxTotal,
        totalAfterDiscount,
        payments: dto.payments.map((p) => ({ method: p.method, amount: p.amountMinorUnits })),
        completedAt: completedAt.toISOString(),
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
      sale.employeeNameSnapshot = employeeSnapshot?.employeeName || '';
      sale.employeeRoleSnapshot = employeeSnapshot?.employeeRole || '';
      sale.employeeMaxDiscountSnapshot = employeeSnapshot?.maxDiscount ?? 0;
      sale.customerId = customerId ?? (null as any);
      sale.status = 'completed';
      sale.subtotalMinorUnits = subtotal;
      sale.discountTotalMinorUnits = totalDiscount;
      sale.taxTotalMinorUnits = taxTotal;
      sale.totalMinorUnits = totalAfterDiscount;
      sale.currencyCode = 'EUR';
      sale.ticketNumber = ticketNumber;
      sale.saleSeq = saleSeq;
      sale.hashChainPrev = prevHash;
      sale.hashChainCurrent = currentHash;
      sale.hashVersion = 2;
      sale.completedAt = completedAt;

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
        // Link Stripe PaymentIntent to sale for reconciliation
        if (p.stripePaymentIntentId) {
          payment.stripePaymentIntentId = p.stripePaymentIntentId;
        }
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

      // --- Redeem store-credit avoirs as tender, atomically with the sale ---
      await this.applyStoreCreditRedemptions(queryRunner, storeId, saved.id, dto.payments);

      // --- Persist idempotency key in the SAME transaction as the sale, so the
      // sale and its dedup record commit (or roll back) atomically. A concurrent
      // duplicate hits the PK unique constraint → 23505 → retried → cache hit. ---
      if (idemKey) {
        await queryRunner.manager.insert(IdempotencyKeyEntity, {
          key: idemKey,
          endpoint: '/sales',
          customerId: customerId ?? null,
          responseStatus: 201,
          responseBody: this.toJsonBody(saved) as any,
          expiresAt: this.idempotencyExpiry(),
        });
      }

      // --- COMMIT ---
      await queryRunner.commitTransaction();

      // --- Post-transaction: Business event logging ---
      logBusinessEvent({
        event: 'SALE_COMPLETED',
        storeId,
        employeeId,
        data: {
          saleId: saved.id,
          ticketNumber,
          totalMinorUnits: totalAfterDiscount,
          itemCount: lineItems.length,
          discountMinorUnits: totalDiscount,
          paymentMethods: dto.payments.map((p) => p.method),
        },
      });

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

      // ── Sensitive-action audit: discount applied (only when a discount exists) ──
      // Non-blocking — never fails the sale. No sensitive data, metadata only.
      if (totalDiscount > 0) {
        try {
          const subtotalForPct = subtotal > 0 ? subtotal : 0;
          await this.auditService.log({
            storeId,
            employeeId,
            action: 'discount_applied',
            entityType: 'sale',
            entityId: saved.id,
            details: {
              ticketNumber,
              discountMinorUnits: totalDiscount,
              subtotalMinorUnits: subtotalForPct,
              discountPct: subtotalForPct > 0
                ? Math.round((totalDiscount / subtotalForPct) * 10000) / 100
                : null,
              employeeRole: employeeSnapshot?.employeeRole ?? null,
              source: 'pos_sale',
            },
          });
        } catch (auditErr: any) {
          this.logger.warn(`Audit (discount_applied) failed: ${auditErr?.message}`);
        }
      }

      // Real-time dashboard push (SSE) — fire-and-forget, never blocks the sale.
      try {
        this.realtime.emit(storeId, 'sale.completed', {
          saleId: saved.id,
          ticketNumber,
          totalMinorUnits: totalAfterDiscount,
          itemCount: lineItems.length,
          at: (saved.completedAt ?? new Date()).toISOString(),
        });
      } catch { /* never block the sale */ }

      // Push sale event to TimeWin24 (fire-and-forget — NEVER blocks the sale response)
      this.pushSaleToTimewin(storeId, employeeId, saved.id, ticketNumber, totalAfterDiscount, lineItems.length, saved.completedAt, dto.payments);

      // Peripheral events (physical drivers in V1)
      if (dto.payments.some((p) => p.method === 'cash')) {
        this.logger.log(`[PERIPHERAL] Cash drawer opened for ${ticketNumber}`);

        // ── Sensitive-action audit: cash drawer opened ── (non-blocking)
        const cashTotal = dto.payments
          .filter((p) => p.method === 'cash')
          .reduce((sum, p) => sum + (p.amountMinorUnits ?? 0), 0);
        this.auditService
          .log({
            storeId,
            employeeId,
            action: 'drawer_opened',
            entityType: 'sale',
            entityId: saved.id,
            details: {
              ticketNumber,
              reason: 'cash_payment',
              cashAmountMinorUnits: cashTotal,
              source: 'pos_sale',
            },
          })
          .catch((auditErr: any) =>
            this.logger.warn(`Audit (drawer_opened) failed: ${auditErr?.message}`),
          );
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
      await queryRunner.release();

      // Retry on serialization failure or unique constraint violation
      const isRetryable =
        error?.message?.includes('could not serialize') ||
        error?.message?.includes('duplicate key') ||
        error?.code === '40001' || // serialization_failure
        error?.code === '23505';   // unique_violation

      if (isRetryable && attempt < MAX_RETRIES) {
        this.logger.warn(`Sale transaction conflict (attempt ${attempt}/${MAX_RETRIES}), retrying...`);
        await new Promise(r => setTimeout(r, 10 + Math.random() * 50)); // jitter
        continue; // retry
      }

      this.logger.error(
        `Sale creation failed after ${attempt} attempt(s): ${error?.message}`,
        error?.stack,
      );
      throw error;
    } finally {
      if (queryRunner.isReleased === false) {
        await queryRunner.release();
      }
    }
    } // end retry loop
    // Should never reach here
    throw new BadRequestException('Sale creation failed after max retries');
  }

  /**
   * Push a completed sale to TimeWin24 for analytics.
   * Fire-and-forget with retry (3 attempts: 0s, 2s, 5s).
   * On definitive failure, logs a structured [TW24_PUSH_FAILED] entry — grep-able in prod logs.
   */
  private pushSaleToTimewin(
    storeId: string,
    employeeId: string,
    saleId: string,
    ticketNumber: string,
    totalMinorUnits: number,
    itemCount: number,
    completedAt: Date,
    payments: { method: string; amountMinorUnits: number }[],
  ): void {
    const date = completedAt.toISOString().split('T')[0]; // YYYY-MM-DD
    const hourSlot = completedAt.getHours(); // 0-23
    const revenue = totalMinorUnits / 100; // minor units → euros

    const cardAmount = payments
      .filter((p) => p.method === 'card')
      .reduce((sum, p) => sum + p.amountMinorUnits / 100, 0);
    const cashAmount = payments
      .filter((p) => p.method === 'cash')
      .reduce((sum, p) => sum + p.amountMinorUnits / 100, 0);

    const payload = {
      saleId,
      ticketNumber,
      date,
      hourSlot,
      revenue,
      transactions: 1,
      itemsSold: itemCount,
      cardAmount,
      cashAmount,
    };

    const RETRY_DELAYS_MS = [0, 2_000, 5_000];

    const attempt = async (n: number): Promise<void> => {
      try {
        await this.timewinService.pushEvent(storeId, 'sale.completed', employeeId, payload);
        this.logger.debug(`[TW24] sale.completed pushed: ${ticketNumber} (€${revenue.toFixed(2)}) attempt=${n + 1}`);
      } catch (err: any) {
        if (n + 1 < RETRY_DELAYS_MS.length) {
          this.logger.warn(`[TW24] push attempt ${n + 1} failed (${err?.message}), retrying in ${RETRY_DELAYS_MS[n + 1]}ms...`);
          await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[n + 1]));
          return attempt(n + 1);
        }
        // All retries exhausted — structured failure log for ops/grep
        this.logger.error(
          `[TW24_PUSH_FAILED] sale not synced to TimeWin24 ` +
          `saleId=${saleId} ticket=${ticketNumber} storeId=${storeId} employeeId=${employeeId} ` +
          `revenue=${revenue} date=${date} hourSlot=${hourSlot} error=${err?.message}`,
        );
      }
    };

    attempt(0).catch(() => void 0); // outer safety net — should never throw
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
        const threshold =
          alert.level === 'critical' || alert.level === 'out_of_stock'
            ? product?.stockCriticalThreshold
            : product?.stockAlertThreshold;

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
            threshold,
          },
        });

        // Push stock alert to TimeWin24 for manager notifications
        this.timewinService.pushEvent(storeId, 'stock.alert', employeeId, {
          productId: alert.productId,
          productName: alert.productName,
          ean: alert.ean,
          currentStock: alert.remainingStock,
          threshold,
          level: alert.level,
        }).catch((err: any) =>
          this.logger.warn(`[TW24] Stock alert push failed: ${err?.message}`),
        );
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

    const where: any = { storeId };
    if (options?.date) {
      // Filter by date using raw SQL for DATE() function
      where.createdAt = undefined; // will use qb below
    }

    const qb = this.saleRepo
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.lineItems', 'li')
      .leftJoinAndSelect('s.payments', 'p')
      .where('s.storeId = :storeId', { storeId })
      .orderBy('s.createdAt', 'DESC');

    if (options?.date) {
      qb.andWhere('DATE(s.createdAt) = :date', { date: options.date });
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
    employeeRole?: string,
    maxDiscountPercent?: number,
    reason?: string,
    idempotencyKey?: string,
  ): Promise<SaleEntity> {
    // --- Idempotency: a replayed void must return the cached result, NOT throw
    // "already voided" (which a naive network retry would otherwise hit). ---
    const idemKey = this.normalizeIdempotencyKey(idempotencyKey);
    if (idemKey) {
      const cached = await this.idempotencyRepo.findOne({ where: { key: idemKey } });
      if (cached) {
        this.logger.log(`[IDEMPOTENT] /sales/void replay for key ${idemKey} — returning cached result`);
        return cached.responseBody as unknown as SaleEntity;
      }
    }

    const sale = await this.findOne(id, storeId);
    if (sale.status === 'voided') {
      throw new BadRequestException('Sale already voided');
    }

    // ── Permission check: managers can only void sales under 500€ ──
    const MAX_MANAGER_VOID_CENTS = 50000; // 500€
    if (employeeRole === 'manager' && sale.totalMinorUnits > MAX_MANAGER_VOID_CENTS) {
      logBusinessEvent({
        event: 'VOID_ATTEMPTED',
        storeId,
        employeeId,
        data: { saleId: id, amount: sale.totalMinorUnits, denied: true, reason: 'exceeds_manager_limit' },
      });
      throw new BadRequestException(
        `Annulation refusee : montant (${(sale.totalMinorUnits / 100).toFixed(2)}€) depasse la limite manager (${(MAX_MANAGER_VOID_CENTS / 100).toFixed(2)}€). Contactez un administrateur.`,
      );
    }

    // ── Guard sécurité : void interdit dès qu'un leg cash est réalisé ──
    // Une vente cash encaissée a eu lieu fiscalement ; l'effacer (void) serait
    // une fausse déclaration. L'annulation passe par createReturn.
    //
    // Scope : guard d'intégrité du journal fiscal /CAISSE contre l'exfil cash.
    // Hors scope : void-après-carte-settled (même obligation NF525, gouvernée
    // par un trigger PSP — follow-up : guard unifié réversibilité).
    //
    // Mode de défaillance sous évolution du modèle :
    //   - Ne dépend pas de sale.status.
    //   - Dépend de l'invariant "leg présent ⟹ réalisé" ; fail-safe (over-block)
    //     si cet invariant tombe (ex. futur split-tender ou layaway). La migration
    //     d'un realized: boolean sur sale_payments relâcherait l'over-block, elle
    //     ne fermerait pas un trou — le trou est déjà fermé.
    //
    // Cas net-zéro pré-nommé : une vente cash encaissée puis remboursée par
    // createReturn conserve son leg +cash dans sale_payments. Le guard bloque
    // son void, ce qui est correct (la vente a eu lieu, son annulation passe
    // par la voie return déjà parcourue, pas par void).
    const cashRealized = sale.payments.some(
      (p) => p.method === 'cash' && p.amountMinorUnits > 0,
    );
    if (cashRealized) {
      logBusinessEvent({
        event: 'VOID_ATTEMPTED',
        storeId,
        employeeId,
        data: { saleId: id, amount: sale.totalMinorUnits, denied: true, reason: 'cash_leg_realized' },
      });
      throw new ConflictException(
        "Une vente avec encaissement cash realise ne peut etre annulee par void. " +
        "Utiliser un retour (createReturn) pour generer un remboursement ou un avoir.",
      );
    }

    // Void within transaction
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let avoirRestoredMinorUnits = 0;
    try {
      // M4 — serialize the per-store fiscal-journal chain with the same
      // pessimistic lock the sales chain uses, so the void link cannot fork.
      await queryRunner.query(`SELECT id FROM stores WHERE id = $1 FOR UPDATE`, [storeId]);

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

      // --- M3: restore store-credit avoirs consumed by this sale. Voiding must NOT
      // destroy the customer's credit. Runs exactly once: the void-once guard
      // (status='voided' throws) + idempotency replay prevent any double-restore. ---
      const redemptionRows = await queryRunner.query(
        `SELECT credit_note_id, amount_minor_units FROM credit_note_redemptions
          WHERE sale_id = $1 AND store_id = $2`,
        [sale.id, storeId],
      );
      const redemptions: { credit_note_id: string; amount_minor_units: number | string }[] =
        Array.isArray(redemptionRows) ? redemptionRows : [];
      for (const r of redemptions) {
        const amt = Number(r.amount_minor_units) || 0;
        await queryRunner.query(
          `UPDATE credit_notes
              SET remaining_minor_units = remaining_minor_units + $1,
                  status = CASE WHEN remaining_minor_units + $1 >= total_minor_units
                                THEN 'active' ELSE 'partially_redeemed' END
            WHERE id = $2 AND store_id = $3`,
          [amt, r.credit_note_id, storeId],
        );
        avoirRestoredMinorUnits += amt;
      }

      // --- M4: append an immutable, hash-chained void event to the fiscal
      // journal. NF525: an annulation must be a chained, tamper-evident event,
      // not just a status flip + audit line. Chained per store on the previous
      // journal hash (genesis otherwise); the payload is hashed and stored
      // verbatim. Inside the tx → rolls back atomically with the void. The
      // void-once guard + idempotency replay make this run exactly once. ---
      const GENESIS_HASH = '0'.repeat(64);
      // Head the journal chain on the monotonic integer cursor `journal_seq`,
      // NOT `created_at` — created_at is wall-clock (ms-tie / NTP-backward →
      // ambiguous head → fork). ADR-012 layer 0; the Z-seal borders the voids
      // side of its close-window on this cursor.
      const lastJournal = await queryRunner.query(
        `SELECT journal_seq AS seq, hash_chain_current AS cur
           FROM fiscal_journal
          WHERE store_id = $1 AND journal_seq IS NOT NULL
          ORDER BY journal_seq DESC LIMIT 1`,
        [storeId],
      );
      const hasJournalHead = Array.isArray(lastJournal) && lastJournal.length > 0;
      const journalSeq = (hasJournalHead ? Number(lastJournal[0].seq) : 0) + 1;
      const journalPrevHash = hasJournalHead
        ? lastJournal[0].cur
        : GENESIS_HASH;
      const voidPayload = JSON.stringify({
        type: 'void',
        saleId: sale.id,
        ticketNumber: sale.ticketNumber,
        saleHashChainCurrent: sale.hashChainCurrent,
        totalMinorUnits: sale.totalMinorUnits,
        taxTotalMinorUnits: sale.taxTotalMinorUnits,
        discountTotalMinorUnits: sale.discountTotalMinorUnits,
        avoirRestoredMinorUnits,
        employeeId,
        reason: reason ?? null,
        voidedAt: new Date().toISOString(),
      });
      const journalCurrentHash = sha256(journalPrevHash + voidPayload);
      await queryRunner.manager.insert(FiscalJournalEntity, {
        storeId,
        eventType: 'void',
        refId: sale.id,
        ticketNumber: sale.ticketNumber,
        payload: voidPayload,
        hashChainPrev: journalPrevHash,
        hashChainCurrent: journalCurrentHash,
        journalSeq,
      });

      // Persist idempotency key atomically with the void.
      if (idemKey) {
        await queryRunner.manager.insert(IdempotencyKeyEntity, {
          key: idemKey,
          endpoint: '/sales/void',
          customerId: null,
          responseStatus: 200,
          responseBody: this.toJsonBody(saved) as any,
          expiresAt: this.idempotencyExpiry(),
        });
      }

      await queryRunner.commitTransaction();

      logBusinessEvent({
        event: 'SALE_VOIDED',
        storeId: sale.storeId,
        employeeId,
        data: {
          saleId: sale.id,
          ticketNumber: sale.ticketNumber,
          totalMinorUnits: sale.totalMinorUnits,
        },
      });

      // ── Sensitive-action audit (post-commit, NON-BLOCKING) ──
      // The void is already committed; auditing must never undo or block it.
      // Enriched metadata: amount, reason, role, source, timestamp (auto).
      // NOTE: there is no dedicated `refund` action in the codebase yet — the
      // closest real operation is this void (annulation). A true refund must be
      // a separate feature (route, business/NF525 rules, permissions, audit).
      try {
        await this.auditService.log({
          storeId: sale.storeId,
          employeeId,
          action: 'sale_voided',
          entityType: 'sale',
          entityId: id,
          details: {
            ticketNumber: sale.ticketNumber,
            totalMinorUnits: sale.totalMinorUnits,
            employeeRole: employeeRole ?? null,
            reason: reason ?? null,
            avoirRestoredMinorUnits,
            source: 'pos_void',
          },
        });
      } catch (auditErr: any) {
        this.logger.warn(`Audit (sale_voided) failed: ${auditErr?.message}`);
      }

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
