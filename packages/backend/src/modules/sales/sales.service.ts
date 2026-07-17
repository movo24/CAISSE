import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  Optional,
  Inject,
} from '@nestjs/common';
import type Stripe from 'stripe';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, QueryRunner } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createHash, randomBytes } from 'crypto';
import { SaleEntity } from '../../database/entities/sale.entity';
import { EmployeeEntity } from '../../database/entities/employee.entity';
import { AlertService } from '../../common/alert/alert.service';
import { SaleLineItemEntity } from '../../database/entities/sale-line-item.entity';
import { SalePaymentEntity } from '../../database/entities/sale-payment.entity';
import { IdempotencyKeyEntity } from '../../database/entities/idempotency-key.entity';
import { ProductEntity } from '../../database/entities/product.entity';
import { FiscalJournalEntity } from '../../database/entities/fiscal-journal.entity';
import { PosSessionEntity } from '../../database/entities/pos-session.entity';
import { SaleComponentMovementEntity } from '../../database/entities/sale-component-movement.entity';
import { StockMovementEntity } from '../../database/entities/stock-movement.entity';
import { StoreEntity } from '../../database/entities/store.entity';
import { PosMachineEntity } from '../../database/entities/pos-machine.entity';
import { evaluateEnrollmentGate } from '../machine-enrollment/machine-enrollment.service';
import { ProductsService } from '../products/products.service';
import { CustomersService } from '../customers/customers.service';
import { PromotionsService, CartItem } from '../promotions/promotions.service';
import { PromoCodesService } from '../promo-codes/promo-codes.service';
import { AuditService } from '../audit/audit.service';
import { StockService } from '../stock/stock.service';
import { JackpotService, JackpotResult } from '../jackpot/jackpot.service';
import { TimewinService } from '../timewin/timewin.service';
import { PaginatedResult } from '../../common/dto/pagination.dto';
import { logBusinessEvent } from '../../common/business-logger';
import { RealtimeService } from '../../common/realtime/realtime.service';
import { returningRows } from '../../common/utils/returning-rows';
import { stockCrossingBand } from './stock-alert-crossing.util';

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
    /** Card leg not really captured yet → sale stays payment_pending (decision 6). */
    pendingCapture?: boolean;
  }[];
  /** Manual cart discount (centimes) — capped at 30%, requires a manager approver (decision 5). */
  manualDiscountMinorUnits?: number;
  /** Manager/admin employee id authorising a manual discount. */
  discountApproverId?: string;
  /** Owner-defined promo code applied at the sale (decision 6) — server validates + redeems atomically. */
  promoCode?: string;
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
    @InjectRepository(EmployeeEntity)
    private employeeRepo: Repository<EmployeeEntity>,
    // Optional so existing tests that don't exercise promo codes keep constructing.
    @Optional() private promoCodesService?: PromoCodesService,
    // Optional: bind a sale to the terminal's active POS session. Resolved
    // server-side (never client-declared). Absent → sale carries null session.
    @Optional()
    @InjectRepository(PosSessionEntity)
    private posSessionRepo?: Repository<PosSessionEntity>,
    // Optional: Stripe client (GO WisePad 3 / Stripe prod). Used ONLY to VERIFY a
    // claimed card capture against the real PaymentIntent — never to move money.
    // Absent (no STRIPE_SECRET_KEY / tests) → capture claims are unverifiable and
    // degrade to payment_pending, never trusted as paid.
    @Optional()
    @Inject('STRIPE')
    private readonly stripe?: Stripe,
    // Optional (Partie B — enrôlement machine). Absent (tests existants) → la
    // barrière d'enrôlement est inerte : aucune vente n'est bloquée. Présents,
    // la barrière ne s'applique QUE si le magasin a `enrollmentEnforced = true`.
    @Optional()
    @InjectRepository(StoreEntity)
    private storeRepo?: Repository<StoreEntity>,
    @Optional()
    @InjectRepository(PosMachineEntity)
    private machineRepo?: Repository<PosMachineEntity>,
  ) {}

  /**
   * Barrière d'enrôlement (Partie B). Bloque la vente UNIQUEMENT quand le
   * magasin applique l'enrôlement et que la machine émettrice n'est pas
   * `approved` pour ce magasin. Inerte si les repos ne sont pas injectés
   * (tests) ou si le magasin n'applique pas l'enrôlement (défaut). La décision
   * est le helper pur `evaluateEnrollmentGate`.
   */
  private async assertMachineEnrolled(
    storeId: string,
    machineId?: string | null,
  ): Promise<void> {
    if (!this.storeRepo || !this.machineRepo) return; // barrière inerte
    const store = await this.storeRepo.findOne({
      where: { id: storeId },
      select: ['id', 'enrollmentEnforced'],
    });
    if (!store?.enrollmentEnforced) return; // magasin sans enrôlement appliqué
    const machine = machineId
      ? await this.machineRepo.findOne({ where: { machineId } })
      : null;
    const gate = evaluateEnrollmentGate({ enforced: true, storeId, machine });
    if (!gate.allowed) {
      this.logger.warn(
        `[ENROLLMENT] Vente refusée store=${storeId} machine=${machineId ?? 'aucune'} raison=${gate.reason}`,
      );
      throw new ForbiddenException({
        code: 'MACHINE_NOT_ENROLLED',
        reason: gate.reason,
        message:
          'Cette caisse n’est pas encore validée par le back-office. La vente est bloquée tant que la machine n’est pas approuvée.',
      });
    }
  }

  /**
   * Resolve the register binding (session + terminal) for a sale, SERVER-SIDE.
   * A sale is bound to a session ONLY when an active session exists for
   * (storeId, terminalId) AND it belongs to the acting employee — never on the
   * word of the client. When the terminal is known but no matching active
   * session is found, the terminal is still recorded (a fact) with a null
   * session ("session unknown", auditable). No terminal header → both null.
   */
  private async resolveRegisterBinding(
    storeId: string,
    employeeId: string,
    terminalId?: string | null,
  ): Promise<{ terminalId: string | null; sessionId: string | null }> {
    const t = terminalId && terminalId.trim() ? terminalId.trim() : null;
    if (!t || !this.posSessionRepo) return { terminalId: t, sessionId: null };
    try {
      const session = await this.posSessionRepo.findOne({
        where: { storeId, terminalId: t, isActive: true },
      });
      if (session && session.employeeId === employeeId) {
        return { terminalId: t, sessionId: session.id };
      }
      return { terminalId: t, sessionId: null };
    } catch (err) {
      this.logger.warn(`resolveRegisterBinding failed (store ${storeId}, terminal ${t}): ${err}`);
      return { terminalId: t, sessionId: null };
    }
  }

  /**
   * GO WisePad 3 / Stripe prod — verify claimed card captures SERVER-SIDE.
   *
   * Invariant (mission): « a card payment is not paid until captured » — and the
   * capture claim must be PROVEN, never taken on the client's word. For every
   * card leg NOT flagged pendingCapture:
   *
   *  - no PaymentIntent id            → claim unverifiable → forced pendingCapture
   *    (sale lands payment_pending « à régulariser » — honest, never silently paid);
   *  - PI id, Stripe configured       → retrieve the PI and require
   *    status === 'succeeded' AND metadata.storeId === storeId AND
   *    amount_received ≥ leg amount. A missing/foreign/unpaid/short PI is a FAKE
   *    payment claim → the sale is REFUSED (goods must not leave on it);
   *  - PI id, Stripe NOT configured   → cannot verify → forced pendingCapture;
   *  - Stripe network/5xx failure     → degraded mode: forced pendingCapture
   *    (sales continue during degraded payment flow; settlement regularised later).
   *
   * Mutates the dto legs (pendingCapture=true) so the existing decision-6
   * machinery (payment_pending + manager queue + alert) applies unchanged.
   * Read-only towards Stripe — this method never moves money.
   */
  private async verifyCardCaptureClaims(
    storeId: string,
    payments: CreateSaleDto['payments'],
  ): Promise<void> {
    for (const p of payments) {
      if (p.method !== 'card' || p.pendingCapture) continue;

      if (!p.stripePaymentIntentId) {
        this.logger.warn(
          `[CARD-VERIFY] store ${storeId}: card capture claimed WITHOUT PaymentIntent — degraded to payment_pending`,
        );
        p.pendingCapture = true;
        continue;
      }

      if (!this.stripe) {
        this.logger.warn(
          `[CARD-VERIFY] store ${storeId}: Stripe not configured — capture claim for ${p.stripePaymentIntentId} unverifiable, degraded to payment_pending`,
        );
        p.pendingCapture = true;
        continue;
      }

      let pi: Stripe.PaymentIntent;
      try {
        pi = await this.stripe.paymentIntents.retrieve(p.stripePaymentIntentId);
      } catch (err: any) {
        if (err?.code === 'resource_missing' || err?.statusCode === 404) {
          // The PI does not exist — a fabricated payment claim. Refuse the sale.
          throw new BadRequestException(
            `Paiement carte invalide : PaymentIntent introuvable (${p.stripePaymentIntentId}).`,
          );
        }
        // Network / Stripe outage → degraded mode, never a fake "paid".
        this.logger.warn(
          `[CARD-VERIFY] store ${storeId}: Stripe unreachable for ${p.stripePaymentIntentId} (${err?.message}) — degraded to payment_pending`,
        );
        p.pendingCapture = true;
        continue;
      }

      if (pi.metadata?.storeId && pi.metadata.storeId !== storeId) {
        this.logger.warn(
          `[SECURITY] store ${storeId} claimed PI ${pi.id} owned by store ${pi.metadata.storeId}`,
        );
        throw new BadRequestException('Paiement carte invalide : PaymentIntent d\'un autre magasin.');
      }
      if (pi.status !== 'succeeded') {
        throw new BadRequestException(
          `Paiement carte non capturé (statut Stripe: ${pi.status}) — encaissement refusé.`,
        );
      }
      const received = (pi as any).amount_received ?? pi.amount;
      if (received < p.amountMinorUnits) {
        throw new BadRequestException(
          `Paiement carte insuffisant : ${received} reçu < ${p.amountMinorUnits} déclaré.`,
        );
      }
      this.logger.log(
        `[CARD-VERIFY] store ${storeId}: PI ${pi.id} verified (succeeded, ${received} ≥ ${p.amountMinorUnits})`,
      );
    }
  }

  /** Manual store discounts are capped here (decision 5) — never above 30%. */
  private static readonly MANUAL_DISCOUNT_MAX_PCT = 30;

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
    terminalId?: string | null,
    machineId?: string | null,
  ): Promise<SaleEntity> {
    // --- Idempotency (NF525): a replayed offline-sync POST must NEVER create a
    // second sale. Fast path BEFORE validation so a replay does not falsely fail
    // on "insufficient stock" if the catalogue moved on since the original sale.
    // Runs BEFORE the enrollment gate: un replay d'une vente DÉJÀ acceptée ne
    // doit pas être rebloqué si l'enrôlement a changé entre-temps.
    const idemKey = this.normalizeIdempotencyKey(idempotencyKey);
    if (idemKey) {
      const cached = await this.idempotencyRepo.findOne({ where: { key: idemKey } });
      if (cached) {
        this.logger.log(`[IDEMPOTENT] /sales replay for key ${idemKey} — returning cached sale`);
        return this.replaySaleResponse(cached);
      }
    }

    // --- Enrollment gate (Partie B): bloque une NOUVELLE vente tant que la
    // machine n'est pas validée, uniquement si le magasin applique l'enrôlement.
    await this.assertMachineEnrolled(storeId, machineId);

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
      // Per-store price override (decision 4): an active override wins over the
      // base price. Applied to the in-memory product so it flows consistently
      // through line totals, promos, the sale total and the fiscal hash.
      product.priceMinorUnits = await this.productsService.resolveEffectivePrice(product);
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

    // --- Pre-transaction: validate PACK COMPONENT stock (advisory, Product
    // Packs). Comme le check parent ci-dessus, cette lecture peut être périmée
    // sous concurrence — la garde AUTORITAIRE reste le décrément conditionnel
    // dans la transaction. Ici on refuse tôt (message clair) au lieu d'ouvrir
    // une transaction vouée au rollback. ---
    {
      const neededByComponent = new Map<string, number>();
      for (const [ean, qty] of requestedQty) {
        const product = resolvedProducts.get(ean)!;
        const comps = await this.dataSource.query(
          `SELECT component_product_id AS component_product_id,
                  quantity_per_parent AS quantity_per_parent
             FROM product_components
            WHERE parent_product_id = $1 AND store_id = $2 AND is_active = true`,
          [product.id, storeId],
        );
        for (const c of Array.isArray(comps) ? comps : []) {
          neededByComponent.set(
            c.component_product_id,
            (neededByComponent.get(c.component_product_id) || 0) + Number(c.quantity_per_parent) * qty,
          );
        }
      }
      for (const [componentId, needed] of neededByComponent) {
        const rows = await this.dataSource.query(
          `SELECT name AS name, stock_quantity AS stock_quantity FROM products WHERE id = $1 AND store_id = $2`,
          [componentId, storeId],
        );
        const comp = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
        if (!comp || Number(comp.stock_quantity) < needed) {
          throw new BadRequestException(
            `Stock insuffisant pour le composant « ${comp?.name ?? componentId} » du pack : ` +
              `${needed} requis, ${comp ? Number(comp.stock_quantity) : 0} disponible — vente refusée.`,
          );
        }
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

    // --- Enforce maxDiscount limit (governs promo/auto discounts) ---
    const maxDiscountPct = employeeSnapshot?.maxDiscount ?? 100;
    if (maxDiscountPct < 100 && subtotal > 0) {
      const maxAllowedDiscount = Math.floor(subtotal * (maxDiscountPct / 100));
      if (totalDiscount > maxAllowedDiscount) {
        throw new BadRequestException(
          `Discount ${totalDiscount} exceeds employee limit of ${maxDiscountPct}% (max ${maxAllowedDiscount} on subtotal ${subtotal})`,
        );
      }
    }

    // --- Manual store discount (decision 5): no free seller discount; a manual
    //     discount REQUIRES a manager/admin approver, is capped HARD at 30% of the
    //     subtotal (never more), is distributed proportionally across the lines so
    //     per-line tax stays consistent, and is audited with the approver id. ---
    const manualDiscount = Math.max(0, dto.manualDiscountMinorUnits ?? 0);
    let discountApproverId: string | null = null;
    let promoMeta: { promoCodeId: string; discountApplied: number } | null = null;
    if (manualDiscount > 0) {
      if (subtotal <= 0) throw new BadRequestException('Remise impossible sur un panier vide.');
      const cap = Math.floor(subtotal * (SalesService.MANUAL_DISCOUNT_MAX_PCT / 100));
      if (manualDiscount > cap) {
        throw new BadRequestException(
          `Remise (${(manualDiscount / 100).toFixed(2)}€) supérieure au plafond de ${SalesService.MANUAL_DISCOUNT_MAX_PCT}% (max ${(cap / 100).toFixed(2)}€) — refusée.`,
        );
      }
      // A manual discount is never free: a manager/admin must authorise it.
      if (!dto.discountApproverId) {
        throw new BadRequestException('Remise manuelle : validation d’un responsable requise (code/validation responsable).');
      }
      const approver = await this.employeeRepo.findOne({ where: { id: dto.discountApproverId, storeId } });
      if (!approver || !['manager', 'admin'].includes((approver.role ?? '').toLowerCase())) {
        throw new BadRequestException('Remise refusée : approbateur invalide (un responsable est requis).');
      }
      discountApproverId = approver.id;

      // Distribute the cart discount across lines proportionally (last line absorbs
      // the rounding remainder so the sum is exact and no line goes negative).
      let remaining = manualDiscount;
      for (let idx = 0; idx < lineItems.length; idx++) {
        const li = lineItems[idx];
        const share = idx === lineItems.length - 1
          ? remaining
          : Math.min(remaining, Math.round((manualDiscount * li.lineTotalMinorUnits) / subtotal));
        const applied = Math.min(share, li.lineTotalMinorUnits);
        li.discountMinorUnits += applied;
        li.lineTotalMinorUnits -= applied;
        remaining -= applied;
      }
      totalDiscount += manualDiscount - remaining;
    }

    // --- Promo code applied at the sale (decision 6): owner-defined, so NOT subject
    //     to the seller's 30% cap or the employee maxDiscount. Validated read-only
    //     here (to compute the discount); the use is RESERVED atomically inside the
    //     transaction (reserveAtSale) so the cap can't be exceeded by a concurrent
    //     sale. V1 supports store-wide codes; a product/category-scoped code is
    //     rejected at the multi-line sale with its validation reason. ---
    if (dto.promoCode && dto.promoCode.trim()) {
      if (!this.promoCodesService) throw new BadRequestException('Codes promo indisponibles.');
      const v = await this.promoCodesService.validate(dto.promoCode, storeId);
      if (!v.valid) throw new BadRequestException(v.reason ?? 'Code promo invalide.');
      const base = subtotal - totalDiscount; // = sum of current line totals
      if (base <= 0) throw new BadRequestException('Code promo : aucun montant à remiser.');
      let promoDiscount = v.discountType === 'percentage'
        ? Math.floor(base * ((v.discountValue ?? 0) / 100))
        : Math.min(v.discountValue ?? 0, base);
      promoDiscount = Math.max(0, Math.min(promoDiscount, base));
      if (promoDiscount > 0) {
        let remaining = promoDiscount;
        for (let idx = 0; idx < lineItems.length; idx++) {
          const li = lineItems[idx];
          const share = idx === lineItems.length - 1
            ? remaining
            : Math.min(remaining, Math.round((promoDiscount * li.lineTotalMinorUnits) / base));
          const applied = Math.min(share, li.lineTotalMinorUnits);
          li.discountMinorUnits += applied;
          li.lineTotalMinorUnits -= applied;
          remaining -= applied;
        }
        const applied = promoDiscount - remaining;
        totalDiscount += applied;
        promoMeta = { promoCodeId: v.promoCodeId!, discountApplied: applied };
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

    // --- GO WisePad 3 / Stripe prod: PROVE claimed card captures against the
    // real PaymentIntent BEFORE the transaction (network read, no tx held).
    // Fake/foreign/unpaid PI → sale refused. Unverifiable → payment_pending. ---
    await this.verifyCardCaptureClaims(storeId, dto.payments);

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

      const lastSaleResult = await queryRunner.query(
        `SELECT ticket_number FROM sales
         WHERE store_id = $1
         ORDER BY ticket_number DESC
         LIMIT 1`,
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
         ORDER BY ticket_number DESC
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
      sale.discountApproverId = discountApproverId;
      sale.taxTotalMinorUnits = taxTotal;
      sale.totalMinorUnits = totalAfterDiscount;
      sale.currencyCode = 'EUR';
      sale.ticketNumber = ticketNumber;
      sale.hashChainPrev = prevHash;
      sale.hashChainCurrent = currentHash;
      sale.hashVersion = 2;
      sale.completedAt = completedAt;

      // Jeton public du ticket numérique — opaque, non devinable (192 bits),
      // généré serveur, HORS empreinte de hash (comme sessionId/terminalId).
      // Un rejeu idempotent renvoie la vente cachée avec CE jeton (réimpression
      // = même QR) ; une nouvelle vente en génère toujours un nouveau. Une
      // collision (improbable) frappe l'index unique → 23505 → retry global.
      sale.publicToken = randomBytes(24).toString('base64url');

      // Register binding — resolved server-side, OUTSIDE the fiscal hash above.
      // Binds to the terminal's active session only if it belongs to this
      // employee; otherwise session stays null (auditable "session unknown").
      const registerBinding = await this.resolveRegisterBinding(storeId, employeeId, terminalId);
      sale.terminalId = registerBinding.terminalId;
      sale.sessionId = registerBinding.sessionId;

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
        // Decision 6: a leg flagged pendingCapture is NOT really captured — the
        // sale will be payment_pending and never counts as paid until regularised.
        payment.captured = !p.pendingCapture;
        payment.capturedAt = p.pendingCapture ? null : completedAt;
        return payment;
      });

      // Decision 6: NO "paid" ticket without real capture. If any leg is not
      // captured, the sale is payment_pending (à régulariser) — the goods left,
      // the payment is owed. The fiscal record (hash) is sealed either way.
      const hasUncaptured = sale.payments.some((p) => !p.captured);
      if (hasUncaptured) {
        sale.status = 'payment_pending';
      }

      // --- Save sale (cascade saves lineItems + payments) ---
      const saved = await queryRunner.manager.save(SaleEntity, sale);

      // --- Reserve the promo-code use atomically IN THE SAME TX (decision 6). If
      //     the cap was hit by a concurrent sale, this throws → the whole sale rolls
      //     back (no over-redemption, no sale committed with an unearned discount). ---
      if (promoMeta && this.promoCodesService) {
        await this.promoCodesService.reserveAtSale(queryRunner.manager, {
          promoCodeId: promoMeta.promoCodeId,
          storeId,
          employeeId,
          saleId: saved.id,
          discountAppliedMinorUnits: promoMeta.discountApplied,
        });
      }

      // --- Decrement stock atomically within transaction ---
      // BUG FIX (specs pg réels, bloc TEST_DATABASE_URL) : le check stock pré-tx
      // (ligne ~276) lit une valeur PÉRIMÉE sous concurrence, et l'ancien
      // `GREATEST(0, stock - qty)` n'échouait jamais → 10 ventes concurrentes sur
      // un stock de 5 réussissaient TOUTES (sur-vente d'unités fantômes, prouvé
      // par sales-stock-concurrency.pg.spec). Le décrément devient CONDITIONNEL
      // (même patron race-safe que le cap promo) : 0 ligne touchée = stock
      // insuffisant AU MOMENT du commit → la vente entière est rejetée/rollback.
      for (const item of dto.items) {
        const product = resolvedProducts.get(item.ean)!;
        const decRes = await queryRunner.query(
          `UPDATE products
           SET stock_quantity = stock_quantity - $1,
               updated_at = NOW()
           WHERE id = $2 AND store_id = $3 AND stock_quantity >= $1
           RETURNING stock_quantity`,
          [item.quantity, product.id, storeId],
        );
        if (returningRows(decRes).length === 0) {
          throw new BadRequestException(
            `Insufficient stock for ${product.name} (${item.ean}): ` +
              `${item.quantity} requested, stock épuisé au moment de la validation`,
          );
        }
      }

      // --- Journal de stock unifié — bloc F1 (shadow). Flag OFF par défaut :
      //     AUCUN mouvement écrit, comportement identique (prouvé par la suite).
      //     ON : écriture double dans la MÊME tx ; la caisse lit toujours le
      //     scalaire (lecture inchangée). Les mouvements sont HORS empreinte de
      //     hash (déjà calculée ligne 745) — aucun hash de vente n'est modifié.
      const stockJournalShadow = process.env.STOCK_JOURNAL_SHADOW === 'true';
      const shadowEmployeeName = sale.employeeNameSnapshot || employeeId;

      // --- Product Packs (GO owner 2026-07-09) : composants dans la MÊME tx ---
      // Le parent reste la seule ligne commerciale (CA/ticket inchangés). Chaque
      // composant ACTIF sort du stock avec le même décrément conditionnel
      // race-safe : 0 ligne touchée = stock composant insuffisant → la vente
      // ENTIÈRE est rejetée (rollback — aucun mouvement partiel, aucun stock
      // fantôme). La composition consommée est FIGÉE dans
      // sale_component_movements (snapshot + traçabilité : vente, ligne,
      // parent, composant, quantités, session, employé) — HORS hash fiscal,
      // comme session_id/terminal_id ci-dessus.
      for (const li of lineItems) {
        const components = await queryRunner.query(
          `SELECT pc.component_product_id AS component_product_id,
                  pc.quantity_per_parent AS quantity_per_parent,
                  p.name AS component_name
             FROM product_components pc
             JOIN products p ON p.id = pc.component_product_id
            WHERE pc.parent_product_id = $1 AND pc.store_id = $2 AND pc.is_active = true`,
          [li.productId, storeId],
        );
        for (const comp of Array.isArray(components) ? components : []) {
          const consumed = Number(comp.quantity_per_parent) * li.quantity;
          const compDec = await queryRunner.query(
            `UPDATE products
             SET stock_quantity = stock_quantity - $1,
                 updated_at = NOW()
             WHERE id = $2 AND store_id = $3 AND stock_quantity >= $1
             RETURNING stock_quantity`,
            [consumed, comp.component_product_id, storeId],
          );
          if (returningRows(compDec).length === 0) {
            throw new BadRequestException(
              `Stock insuffisant pour le composant « ${comp.component_name} » ` +
                `(inclus dans ${li.productName}) : ${consumed} requis — vente refusée, aucun mouvement partiel.`,
            );
          }
          await queryRunner.manager.insert(SaleComponentMovementEntity, {
            storeId,
            saleId: saved.id,
            saleLineItemId: li.id,
            parentProductId: li.productId,
            componentProductId: comp.component_product_id,
            quantityPerParent: Number(comp.quantity_per_parent),
            quantityConsumed: consumed,
            employeeId,
            sessionId: registerBinding.sessionId,
            terminalId: registerBinding.terminalId,
          });
          if (stockJournalShadow) {
            await queryRunner.manager.insert(StockMovementEntity, {
              productId: comp.component_product_id,
              movementType: 'pack_consumption',
              fromLocationId: null,
              toLocationId: null,
              quantity: consumed,
              reference: ticketNumber,
              employeeId,
              employeeName: shadowEmployeeName,
              storeId,
              saleId: sale.id,
              saleLineItemId: li.id,
              occurredAt: completedAt,
            });
          }
        }
      }

      // Mouvement 'sale' par ligne (parent facturé) — même tx, idempotent via
      // l'index unique partiel (F0). N'entre dans aucun hash.
      if (stockJournalShadow) {
        for (const li of lineItems) {
          await queryRunner.manager.insert(StockMovementEntity, {
            productId: li.productId,
            movementType: 'sale',
            fromLocationId: null,
            toLocationId: null,
            quantity: li.quantity,
            reference: ticketNumber,
            employeeId,
            employeeName: shadowEmployeeName,
            storeId,
            saleId: sale.id,
            saleLineItemId: li.id,
            occurredAt: completedAt,
          });
        }
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
            terminalId: saved.terminalId ?? null,
            sessionId: saved.sessionId ?? null,
            sessionBound: saved.sessionId != null,
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
              manualDiscountMinorUnits: manualDiscount,
              discountApproverId, // the manager/admin who authorised the manual discount (decision 5)
              promoCode: promoMeta ? (dto.promoCode ?? '').trim().toUpperCase() : null, // decision 6
              promoCodeId: promoMeta?.promoCodeId ?? null,
              promoDiscountMinorUnits: promoMeta?.discountApplied ?? null,
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

      // ── Payment-pending (decision 6): a sale left with an uncaptured card leg is
      //    "à régulariser" — alert the manager + audit. Never silently "paid". ──
      if (saved.status === 'payment_pending') {
        const pendingMinor = saved.payments
          .filter((p) => !p.captured)
          .reduce((sum, p) => sum + p.amountMinorUnits, 0);
        AlertService.instance.fire(
          'PAYMENT_PENDING_CAPTURE',
          `Vente ${ticketNumber} (magasin ${storeId}) : ${(pendingMinor / 100).toFixed(2)}€ carte à régulariser`,
        );
        try {
          await this.auditService.log({
            storeId,
            employeeId,
            action: 'payment_pending',
            entityType: 'sale',
            entityId: saved.id,
            details: { ticketNumber, pendingMinorUnits: pendingMinor, totalMinorUnits: totalAfterDiscount },
          });
        } catch (auditErr: any) {
          this.logger.warn(`Audit (payment_pending) failed: ${auditErr?.message}`);
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
      const oldQty = product.stockQuantity;
      const newQty = Math.max(0, oldQty - item.quantity);

      // Edge-triggered: alert ONLY when this sale moves the product into a MORE
      // severe band (out_of_stock > critical > alert). A product already below a
      // threshold no longer re-alerts on every subsequent sale (was: audit noise
      // + repeated TW24 pushes to managers). Aligned with StockService.decrementStock.
      const band = stockCrossingBand(
        oldQty,
        newQty,
        product.stockAlertThreshold,
        product.stockCriticalThreshold,
      );
      if (!band) continue;

      if (band === 'out_of_stock') {
        alerts.push({
          productId: product.id,
          productName: product.name,
          ean: product.ean,
          remainingStock: 0,
          level: 'out_of_stock',
          message: `${product.name} est en rupture de stock !`,
        });
      } else if (band === 'critical') {
        alerts.push({
          productId: product.id,
          productName: product.name,
          ean: product.ean,
          remainingStock: newQty,
          level: 'critical',
          message: `${product.name}: stock critique (${newQty} restant${newQty > 1 ? 's' : ''})`,
        });
      } else {
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

  /** Sales with an uncaptured card leg — the manager's "à régulariser" queue (decision 6). */
  async listPendingPayments(storeId: string): Promise<SaleEntity[]> {
    return this.saleRepo.find({
      where: { storeId, status: 'payment_pending' },
      relations: ['payments'],
      order: { completedAt: 'DESC' },
    });
  }

  /**
   * Regularise a pending card leg (decision 6): mark it captured when the card is
   * REALLY taken — then if all legs are captured the sale becomes completed. A
   * FAILED capture leaves the sale payment_pending (anomaly), audited + alerted.
   * Never simulates a payment.
   */
  async regularizePayment(
    saleId: string,
    storeId: string,
    employeeId: string,
    opts: { paymentId?: string; stripePaymentIntentId?: string; success: boolean },
  ): Promise<{ saleId: string; status: string; regularized: boolean }> {
    const sale = await this.saleRepo.findOne({ where: { id: saleId, storeId }, relations: ['payments'] });
    if (!sale) throw new NotFoundException('Sale not found');
    if (sale.status !== 'payment_pending') throw new BadRequestException('Sale is not pending capture');
    const leg = sale.payments.find((p) => !p.captured && (!opts.paymentId || p.id === opts.paymentId));
    if (!leg) throw new BadRequestException('No uncaptured payment leg to regularise');

    if (!opts.success) {
      // Capture failed — the sale STAYS an anomaly (never falsely "paid").
      AlertService.instance.fire(
        'PAYMENT_PENDING_CAPTURE',
        `Vente ${sale.ticketNumber} (magasin ${storeId}) : capture carte ÉCHOUÉE — reste à régulariser`,
      );
      await this.auditService.log({
        storeId, employeeId, action: 'payment_capture_failed', entityType: 'sale', entityId: saleId,
        details: { paymentId: leg.id, ticketNumber: sale.ticketNumber },
      });
      return { saleId, status: sale.status, regularized: false };
    }

    leg.captured = true;
    leg.capturedAt = new Date();
    if (opts.stripePaymentIntentId) leg.stripePaymentIntentId = opts.stripePaymentIntentId;
    await this.paymentRepo.save(leg);

    if (!sale.payments.some((p) => !p.captured)) {
      sale.status = 'completed';
      await this.saleRepo.save(sale);
    }
    await this.auditService.log({
      storeId, employeeId, action: 'payment_regularized', entityType: 'sale', entityId: saleId,
      details: { paymentId: leg.id, saleStatus: sale.status },
    });
    return { saleId, status: sale.status, regularized: true };
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
    terminalId?: string | null,
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

      // Restore stock atomically (produits parents facturés)
      // Journal de stock unifié — F2 : sous flag, chaque restitution écrit AUSSI
      // son mouvement inverse 'void' dans la MÊME tx. Hors empreinte de hash (le
      // hash de la vente d'origine reste intact : le void est un maillon append-only).
      const stockJournalShadow = process.env.STOCK_JOURNAL_SHADOW === 'true';
      // Ce chemin ne dispose pas d'un snapshot de nom : l'acteur est l'employé qui annule.
      const shadowEmployeeName = employeeId;
      for (const item of sale.lineItems) {
        await queryRunner.query(
          `UPDATE products
           SET stock_quantity = stock_quantity + $1, updated_at = NOW()
           WHERE id = $2 AND store_id = $3`,
          [item.quantity, item.productId, storeId],
        );
        if (stockJournalShadow) {
          await queryRunner.manager.insert(StockMovementEntity, {
            productId: item.productId,
            movementType: 'void',
            fromLocationId: null,
            toLocationId: null,
            quantity: item.quantity,
            reference: sale.ticketNumber,
            employeeId,
            employeeName: shadowEmployeeName,
            storeId,
            saleId: sale.id,
            saleLineItemId: item.id,
          });
        }
      }

      // --- F2 / correctif G3 : restituer AUSSI les composants de pack, depuis le
      // SNAPSHOT FIGÉ de la vente (`sale_component_movements`), jamais depuis la
      // composition courante — miroir exact de `createReturn`. AVANT ce bloc, le
      // void recréditait le parent mais PERDAIT définitivement les composants
      // (fuite de stock permanente = bug G3). Même tx que le statut + le maillon
      // fiscal : tout réussit ou rien. Idempotent via la garde void-once + la clé. ---
      const componentRows = await queryRunner.query(
        `SELECT sale_line_item_id, component_product_id, quantity_consumed
           FROM sale_component_movements
          WHERE sale_id = $1 AND store_id = $2`,
        [sale.id, storeId],
      );
      for (const cm of Array.isArray(componentRows) ? componentRows : []) {
        const restoreQty = Number(cm.quantity_consumed);
        if (!(restoreQty > 0)) continue;
        await queryRunner.query(
          `UPDATE products
           SET stock_quantity = stock_quantity + $1, updated_at = NOW()
           WHERE id = $2 AND store_id = $3`,
          [restoreQty, cm.component_product_id, storeId],
        );
        if (stockJournalShadow) {
          await queryRunner.manager.insert(StockMovementEntity, {
            productId: cm.component_product_id,
            movementType: 'void',
            fromLocationId: null,
            toLocationId: null,
            quantity: restoreQty,
            reference: sale.ticketNumber,
            employeeId,
            employeeName: shadowEmployeeName,
            storeId,
            saleId: sale.id,
            saleLineItemId: cm.sale_line_item_id,
          });
        }
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
      const lastJournal = await queryRunner.query(
        `SELECT hash_chain_current FROM fiscal_journal
          WHERE store_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [storeId],
      );
      const journalPrevHash =
        Array.isArray(lastJournal) && lastJournal.length > 0
          ? lastJournal[0].hash_chain_current
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
      // Void-time register binding — resolved server-side, recorded in the
      // audit trail only (NOT the fiscal void payload above, whose fingerprint
      // must stay stable). Ties the annulation to the terminal's active session.
      const voidBinding = await this.resolveRegisterBinding(storeId, employeeId, terminalId);
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
            terminalId: voidBinding.terminalId,
            sessionId: voidBinding.sessionId,
            sessionBound: voidBinding.sessionId != null,
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
