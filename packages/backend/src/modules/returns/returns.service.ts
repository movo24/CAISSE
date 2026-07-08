import { Injectable, Logger, BadRequestException, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createHash, randomBytes } from 'crypto';
import { CreditNoteEntity } from '../../database/entities/credit-note.entity';
import { CreditNoteLineEntity } from '../../database/entities/credit-note-line.entity';
import { SaleEntity } from '../../database/entities/sale.entity';
import { IdempotencyKeyEntity } from '../../database/entities/idempotency-key.entity';
import { PosSessionEntity } from '../../database/entities/pos-session.entity';
import { FiscalJournalEntity } from '../../database/entities/fiscal-journal.entity';
import { AuditService } from '../audit/audit.service';
import { EmployeeScoreService } from '../employee-score/employee-score.service';
import { PaginatedResult } from '../../common/dto/pagination.dto';

const GENESIS = '0'.repeat(64);
function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export interface ReturnItemInput {
  lineItemId: string;
  quantity: number;
}
export interface CreateReturnDto {
  originalSaleId: string;
  items: ReturnItemInput[];
  reason?: string;
  refundMethod: 'cash' | 'card' | 'store_credit';
}

@Injectable()
export class ReturnsService {
  private readonly logger = new Logger(ReturnsService.name);

  constructor(
    @InjectRepository(CreditNoteEntity) private cnRepo: Repository<CreditNoteEntity>,
    @InjectRepository(SaleEntity) private saleRepo: Repository<SaleEntity>,
    @InjectRepository(IdempotencyKeyEntity) private idemRepo: Repository<IdempotencyKeyEntity>,
    private dataSource: DataSource,
    private auditService: AuditService,
    // Optionnels : le binding session et le score n'empêchent JAMAIS un avoir
    // (résilience) — absents dans les specs unitaires qui construisent à la main.
    @Optional()
    @InjectRepository(PosSessionEntity)
    private posSessionRepo?: Repository<PosSessionEntity>,
    @Optional() private scoreService?: EmployeeScoreService,
  ) {}

  /**
   * Résout le rattachement caisse (session + terminal) d'un retour, CÔTÉ
   * SERVEUR — mêmes règles que SalesService.resolveRegisterBinding : lié à la
   * session ACTIVE du terminal seulement si elle appartient à l'employé qui
   * agit ; sinon terminal enregistré (fait) et session null (« session
   * inconnue », auditable). Jamais sur la parole du client.
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

  private normalizeIdempotencyKey(key?: string): string | undefined {
    if (!key) return undefined;
    const t = key.trim();
    if (!t) return undefined;
    if (t.length > 64) throw new BadRequestException('Idempotency-Key too long (max 64 chars)');
    return t;
  }

  private genCode(): string {
    return 'AV-' + randomBytes(5).toString('hex').toUpperCase().slice(0, 10);
  }

  /** Returned quantity already credited per original line item for a sale. */
  async getReturnedQuantities(saleId: string): Promise<Record<string, number>> {
    const rows = await this.dataSource.query(
      `SELECT l.original_line_item_id AS lid, COALESCE(SUM(l.quantity),0) AS qty
         FROM credit_note_lines l
         JOIN credit_notes c ON c.id = l.credit_note_id
        WHERE c.original_sale_id = $1 AND c.status <> 'cancelled'
        GROUP BY l.original_line_item_id`,
      [saleId],
    );
    const map: Record<string, number> = {};
    for (const r of rows) map[r.lid] = parseInt(r.qty, 10);
    return map;
  }

  async createReturn(
    storeId: string,
    employeeId: string,
    dto: CreateReturnDto,
    employeeName?: string,
    idempotencyKey?: string,
    terminalId?: string | null,
  ): Promise<CreditNoteEntity> {
    const idemKey = this.normalizeIdempotencyKey(idempotencyKey);
    if (idemKey) {
      const cached = await this.idemRepo.findOne({ where: { key: idemKey } });
      if (cached) {
        this.logger.log(`[IDEMPOTENT] /returns replay for ${idemKey}`);
        return cached.responseBody as unknown as CreditNoteEntity;
      }
    }

    if (!dto.items?.length) throw new BadRequestException('Aucun article à retourner');
    if (!['cash', 'card', 'store_credit'].includes(dto.refundMethod)) {
      throw new BadRequestException('Mode de remboursement invalide');
    }

    // Original sale (tenant-scoped) — read before the transaction.
    const sale = await this.saleRepo.findOne({ where: { id: dto.originalSaleId, storeId } });
    if (!sale) throw new NotFoundException('Vente introuvable');
    if (sale.status === 'voided') throw new BadRequestException('Vente annulée — retour impossible');

    const lineById = new Map((sale.lineItems || []).map((li) => [li.id, li]));
    const alreadyReturned = await this.getReturnedQuantities(sale.id);

    // Validate + compute refund per line (proportional to the net line total).
    const returnLines: Partial<CreditNoteLineEntity>[] = [];
    let total = 0;
    for (const item of dto.items) {
      const li = lineById.get(item.lineItemId);
      if (!li) throw new BadRequestException(`Ligne introuvable: ${item.lineItemId}`);
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        throw new BadRequestException('Quantité de retour invalide');
      }
      const remaining = li.quantity - (alreadyReturned[li.id] || 0);
      if (item.quantity > remaining) {
        throw new BadRequestException(
          `Quantité retournée (${item.quantity}) dépasse le retournable (${remaining}) pour ${li.productName}`,
        );
      }
      const lineRefund = Math.round((li.lineTotalMinorUnits * item.quantity) / li.quantity);
      total += lineRefund;
      returnLines.push({
        originalLineItemId: li.id,
        productId: li.productId,
        productName: li.productName,
        ean: li.ean,
        quantity: item.quantity,
        unitPriceMinorUnits: li.unitPriceMinorUnits,
        lineTotalMinorUnits: lineRefund,
        taxRate: li.taxRate,
      });
    }
    if (total <= 0) throw new BadRequestException('Montant de retour nul');

    // Rattachement caisse résolu serveur, HORS transaction (lecture seule) et
    // HORS chainPayload (l'empreinte de l'avoir reste {code, storeId,
    // originalSaleId, total, lines} — aucun avoir existant re-hashé).
    const registerBinding = await this.resolveRegisterBinding(storeId, employeeId, terminalId);

    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const qr = this.dataSource.createQueryRunner();
      await qr.connect();
      await qr.startTransaction();
      try {
        if (idemKey) {
          const cachedTx = await qr.manager.findOne(IdempotencyKeyEntity, { where: { key: idemKey } });
          if (cachedTx) {
            await qr.commitTransaction();
            return cachedTx.responseBody as unknown as CreditNoteEntity;
          }
        }

        // M5 — serialize the per-store credit-note hash chain: take the same
        // pessimistic lock the sales path uses (stores FOR UPDATE) BEFORE reading
        // prevHash, so two concurrent returns/gift-cards cannot read the same
        // prevHash and fork the chain.
        await qr.query(`SELECT id FROM stores WHERE id = $1 FOR UPDATE`, [storeId]);

        // Per-store hash chain over credit notes.
        const lastCn = await qr.query(
          `SELECT hash_chain_current FROM credit_notes WHERE store_id = $1 ORDER BY created_at DESC LIMIT 1`,
          [storeId],
        );
        const prevHash = lastCn.length > 0 ? lastCn[0].hash_chain_current : GENESIS;
        const code = this.genCode();

        // D1.4 — numéro d'avoir séquentiel par magasin, attribué SOUS le verrou
        // store déjà tenu (pas de course). Les avoirs historiques restent null.
        const seqRows = await qr.query(
          `SELECT COALESCE(MAX(sequential_number), 0) + 1 AS next
             FROM credit_notes WHERE store_id = $1`,
          [storeId],
        );
        const sequentialNumber = Number(
          (Array.isArray(seqRows) && seqRows[0]?.next) || 1,
        );

        // D1.4 — ventilation TVA de l'avoir : part de taxe contenue dans chaque
        // ligne TTC remboursée (même arrondi ligne à ligne que la vente).
        const taxTotal = returnLines.reduce((sum, l) => {
          const rate = Number(l.taxRate ?? 0);
          const ttc = l.lineTotalMinorUnits ?? 0;
          return sum + (ttc - Math.round(ttc / (1 + rate / 100)));
        }, 0);
        const isStoreCredit = dto.refundMethod === 'store_credit';
        const chainPayload = JSON.stringify({
          code,
          storeId,
          originalSaleId: sale.id,
          total,
          lines: returnLines.map((l) => ({ p: l.productId, q: l.quantity, t: l.lineTotalMinorUnits })),
        });
        const currentHash = sha256(prevHash + chainPayload);

        const cn = new CreditNoteEntity();
        cn.id = uuidv4();
        cn.code = code;
        cn.storeId = storeId;
        cn.origin = 'return';
        cn.originalSaleId = sale.id;
        cn.originalTicketNumber = sale.ticketNumber;
        cn.type = isStoreCredit ? 'store_credit' : 'refund';
        cn.refundMethod = isStoreCredit ? null : dto.refundMethod;
        cn.status = isStoreCredit ? 'active' : 'refunded';
        cn.reason = dto.reason ?? null;
        cn.employeeId = employeeId;
        cn.employeeNameSnapshot = employeeName ?? null;
        cn.totalMinorUnits = total;
        cn.remainingMinorUnits = isStoreCredit ? total : 0;
        cn.currencyCode = sale.currencyCode || 'EUR';
        cn.hashChainPrev = prevHash;
        cn.hashChainCurrent = currentHash;
        cn.sessionId = registerBinding.sessionId;
        cn.terminalId = registerBinding.terminalId;
        // D1.4 — champs opposables (HORS empreinte hash ; scellés via le journal).
        cn.sequentialNumber = sequentialNumber;
        cn.taxTotalMinorUnits = taxTotal;
        // Remboursement CASH → l'acteur est le valideur (POST /returns est
        // manager-gated par les rôles existants — le manager qui exécute approuve).
        cn.approvedByEmployeeId = dto.refundMethod === 'cash' ? employeeId : null;
        cn.lines = returnLines.map((l) => Object.assign(new CreditNoteLineEntity(), l));

        const saved = await qr.manager.save(CreditNoteEntity, cn);

        // Restore stock atomically.
        for (const l of returnLines) {
          await qr.query(
            `UPDATE products SET stock_quantity = stock_quantity + $1, updated_at = NOW() WHERE id = $2 AND store_id = $3`,
            [l.quantity, l.productId, storeId],
          );
        }

        // ── D1.4 (GO owner) — SCELLEMENT fiscal_journal, dans la MÊME transaction.
        // L'avoir est la pièce opposable ; le journal prouve la chronologie et
        // l'intégrité. Quatre maillons chaînés (même mécanique que le void/M4),
        // atomiques avec l'avoir + le stock : toute erreur → rollback complet.
        {
          const lastJournal = await qr.query(
            `SELECT hash_chain_current FROM fiscal_journal
              WHERE store_id = $1 ORDER BY created_at DESC LIMIT 1`,
            [storeId],
          );
          let jPrev =
            Array.isArray(lastJournal) && lastJournal.length > 0
              ? lastJournal[0].hash_chain_current
              : GENESIS;
          const nowIso = new Date().toISOString();
          const base = {
            creditNoteId: saved.id,
            creditNoteCode: code,
            sequentialNumber,
            originalSaleId: sale.id,
            originalTicketNumber: sale.ticketNumber,
            storeId,
            employeeId,
            sessionId: registerBinding.sessionId,
            terminalId: registerBinding.terminalId,
            at: nowIso,
          };
          const events: Array<{ type: string; extra: Record<string, unknown> }> = [
            // 1. La vente d'origine est RÉFÉRENCÉE, jamais modifiée (son hash figé en preuve).
            { type: 'sale_original_referenced', extra: { saleHashChainCurrent: sale.hashChainCurrent } },
            // 2. Émission de la pièce opposable, montants HT/TVA/TTC + lignes.
            {
              type: 'credit_note_issued',
              extra: {
                refundMethod: isStoreCredit ? 'store_credit' : dto.refundMethod,
                reason: dto.reason ?? null,
                totalMinorUnits: total,
                taxTotalMinorUnits: taxTotal,
                netTotalMinorUnits: total - taxTotal,
                creditNoteHashChainCurrent: currentHash,
                approvedByEmployeeId: cn.approvedByEmployeeId,
                lines: returnLines.map((l) => ({
                  p: l.productId, q: l.quantity, t: l.lineTotalMinorUnits, tva: l.taxRate ?? 0,
                })),
              },
            },
            // 3. Restauration du stock (atomique avec l'avoir).
            {
              type: 'stock_restored',
              extra: { restored: returnLines.map((l) => ({ productId: l.productId, quantity: l.quantity })) },
            },
          ];
          // 4. Sortie de caisse : AUCUN mouvement cash négatif sans avoir lié.
          if (!isStoreCredit && dto.refundMethod === 'cash') {
            events.push({
              type: 'cash_refund_recorded',
              extra: {
                cashOutMinorUnits: total,
                sessionBound: registerBinding.sessionId != null,
                approvedByEmployeeId: cn.approvedByEmployeeId,
              },
            });
          }
          for (const ev of events) {
            const payload = JSON.stringify({ type: ev.type, ...base, ...ev.extra });
            const jCurrent = sha256(jPrev + payload);
            await qr.manager.insert(FiscalJournalEntity, {
              storeId,
              eventType: ev.type,
              refId: saved.id,
              ticketNumber: sale.ticketNumber,
              payload,
              hashChainPrev: jPrev,
              hashChainCurrent: jCurrent,
            });
            jPrev = jCurrent;
          }
        }

        if (idemKey) {
          const expiresAt = new Date();
          expiresAt.setDate(expiresAt.getDate() + 7);
          await qr.manager.insert(IdempotencyKeyEntity, {
            key: idemKey,
            endpoint: '/returns',
            customerId: null,
            responseStatus: 201,
            responseBody: JSON.parse(JSON.stringify(saved)),
            expiresAt,
          });
        }

        await qr.commitTransaction();

        // Append-only audit (post-commit, non-blocking).
        this.auditService
          .log({
            storeId,
            employeeId,
            action: 'sale_returned',
            entityType: 'credit_note',
            entityId: saved.id,
            details: {
              code: saved.code,
              originalSaleId: sale.id,
              originalTicketNumber: sale.ticketNumber,
              totalMinorUnits: total,
              type: saved.type,
              refundMethod: saved.refundMethod,
              reason: saved.reason,
              itemCount: returnLines.length,
              hash: currentHash,
              source: 'pos_return',
              terminalId: registerBinding.terminalId,
              sessionId: registerBinding.sessionId,
              sessionBound: registerBinding.sessionId != null,
            },
          })
          .catch((e: any) => this.logger.warn(`Audit (sale_returned) failed: ${e?.message}`));

        // Fait de score AUTORITATIF (serveur) — émis UNIQUEMENT quand le retour
        // est rattaché à une session vérifiée : pas de scoring approximatif.
        // Neutre (0 pt) : un remboursement légitime ne pénalise jamais.
        if (registerBinding.sessionId && this.scoreService) {
          this.scoreService
            .logEvent({
              employeeId,
              storeId,
              eventType: 'REFUND_CREATED',
              terminalId: registerBinding.terminalId,
              sessionId: registerBinding.sessionId,
              reason: saved.reason ?? undefined,
              metadata: {
                creditNoteId: saved.id,
                code: saved.code,
                refundMethod: saved.refundMethod,
                totalMinorUnits: total,
              },
              createdBy: employeeId,
              source: 'returns',
            })
            .catch((e: any) => this.logger.warn(`Score (REFUND_CREATED) failed: ${e?.message}`));
        }

        return saved;
      } catch (err: any) {
        await qr.rollbackTransaction();
        const retryable =
          err?.code === '23505' || err?.code === '40001' ||
          err?.message?.includes('duplicate key') || err?.message?.includes('could not serialize');
        if (retryable && attempt < MAX_RETRIES) {
          this.logger.warn(`Return conflict (attempt ${attempt}), retrying...`);
          continue;
        }
        throw err;
      } finally {
        if (!qr.isReleased) await qr.release();
      }
    }
    throw new BadRequestException('Return failed after max retries');
  }

  private genGiftCode(): string {
    return 'GC-' + randomBytes(5).toString('hex').toUpperCase().slice(0, 10);
  }

  /**
   * Issue / load a gift card — a store_credit avoir not tied to a return.
   * Reuses the credit_notes mechanism (so it is redeemed exactly like an avoir).
   * Idempotent. The chain payload mirrors createReturn for consistency.
   */
  async issueGiftCard(
    storeId: string,
    employeeId: string,
    data: { amountMinorUnits: number; code?: string; saleId?: string },
    employeeName?: string,
    idempotencyKey?: string,
  ): Promise<CreditNoteEntity> {
    const idemKey = this.normalizeIdempotencyKey(idempotencyKey);
    if (idemKey) {
      const cached = await this.idemRepo.findOne({ where: { key: idemKey } });
      if (cached) return cached.responseBody as unknown as CreditNoteEntity;
    }
    const amount = Math.round(data.amountMinorUnits);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Montant de carte cadeau invalide');
    }

    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const qr = this.dataSource.createQueryRunner();
      await qr.connect();
      await qr.startTransaction();
      try {
        if (idemKey) {
          const cachedTx = await qr.manager.findOne(IdempotencyKeyEntity, { where: { key: idemKey } });
          if (cachedTx) {
            await qr.commitTransaction();
            return cachedTx.responseBody as unknown as CreditNoteEntity;
          }
        }
        // M5 — serialize the per-store credit-note hash chain (see issueRefund).
        await qr.query(`SELECT id FROM stores WHERE id = $1 FOR UPDATE`, [storeId]);

        const lastCn = await qr.query(
          `SELECT hash_chain_current FROM credit_notes WHERE store_id = $1 ORDER BY created_at DESC LIMIT 1`,
          [storeId],
        );
        const prevHash = lastCn.length > 0 ? lastCn[0].hash_chain_current : GENESIS;
        const code = (data.code?.trim().toUpperCase()) || this.genGiftCode();
        const currentHash = sha256(prevHash + JSON.stringify({ code, storeId, amount, origin: 'gift_card' }));

        const cn = new CreditNoteEntity();
        cn.id = uuidv4();
        cn.code = code;
        cn.storeId = storeId;
        cn.origin = 'gift_card';
        cn.originalSaleId = data.saleId ?? null;
        cn.originalTicketNumber = null;
        cn.type = 'store_credit';
        cn.refundMethod = null;
        cn.status = 'active';
        cn.reason = 'Émission carte cadeau';
        cn.employeeId = employeeId;
        cn.employeeNameSnapshot = employeeName ?? null;
        cn.totalMinorUnits = amount;
        cn.remainingMinorUnits = amount;
        cn.currencyCode = 'EUR';
        cn.hashChainPrev = prevHash;
        cn.hashChainCurrent = currentHash;
        cn.lines = [];

        const saved = await qr.manager.save(CreditNoteEntity, cn);

        if (idemKey) {
          const expiresAt = new Date();
          expiresAt.setDate(expiresAt.getDate() + 7);
          await qr.manager.insert(IdempotencyKeyEntity, {
            key: idemKey, endpoint: '/returns/gift-card', customerId: null,
            responseStatus: 201, responseBody: JSON.parse(JSON.stringify(saved)), expiresAt,
          });
        }

        await qr.commitTransaction();

        this.auditService
          .log({
            storeId, employeeId, action: 'gift_card_issued', entityType: 'credit_note', entityId: saved.id,
            details: { code: saved.code, amountMinorUnits: amount, saleId: data.saleId ?? null, hash: currentHash, source: 'gift_card' },
          })
          .catch((e: any) => this.logger.warn(`Audit (gift_card_issued) failed: ${e?.message}`));

        return saved;
      } catch (err: any) {
        await qr.rollbackTransaction();
        const retryable =
          err?.code === '23505' || err?.code === '40001' ||
          err?.message?.includes('duplicate key') || err?.message?.includes('could not serialize');
        if (retryable && attempt < MAX_RETRIES) continue;
        throw err;
      } finally {
        if (!qr.isReleased) await qr.release();
      }
    }
    throw new BadRequestException('Gift card issuance failed after max retries');
  }

  /**
   * Create a return identified by the original TICKET NUMBER and EAN-based items.
   * Used by the offline POS sync path (the offline client knows the ticket number
   * and product EANs, not server line-item ids). Resolution + returnable-quantity
   * validation happen here (deferred), so a stale offline return that conflicts
   * with a return made meanwhile is rejected cleanly (BadRequest) at sync time.
   */
  async createReturnByTicket(
    storeId: string,
    employeeId: string,
    dto: { ticketNumber: string; items: { ean: string; quantity: number }[]; reason?: string; refundMethod: 'cash' | 'card' | 'store_credit' },
    employeeName?: string,
    idempotencyKey?: string,
    terminalId?: string | null,
  ): Promise<CreditNoteEntity> {
    const sale = await this.saleRepo.findOne({ where: { ticketNumber: dto.ticketNumber, storeId } });
    if (!sale) throw new NotFoundException(`Vente introuvable pour le ticket ${dto.ticketNumber}`);
    const items = (dto.items || []).map((it) => {
      const li = (sale.lineItems || []).find((l) => l.ean === it.ean);
      if (!li) throw new BadRequestException(`Article absent du ticket: ${it.ean}`);
      return { lineItemId: li.id, quantity: it.quantity };
    });
    // Delegates to the canonical path (validation, hash chain, stock, idempotency,
    // audit, register binding). On an offline replay hours later the terminal's
    // active session will have changed/closed → binding resolves to null
    // ("session inconnue"), never to a fabricated link.
    return this.createReturn(
      storeId,
      employeeId,
      { originalSaleId: sale.id, items, reason: dto.reason, refundMethod: dto.refundMethod },
      employeeName,
      idempotencyKey,
      terminalId,
    );
  }

  async listForStore(
    storeId: string,
    opts: { page?: number; limit?: number; originalSaleId?: string } = {},
  ): Promise<PaginatedResult<CreditNoteEntity>> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
    const page = Math.max(opts.page ?? 1, 1);
    const [data, total] = await this.cnRepo.findAndCount({
      // D1.4 UI — historique des avoirs LIÉS à une vente (tenant-scoped).
      where: opts.originalSaleId ? { storeId, originalSaleId: opts.originalSaleId } : { storeId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: (page - 1) * limit,
    });
    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(id: string, storeId: string): Promise<CreditNoteEntity> {
    const cn = await this.cnRepo.findOne({ where: { id, storeId } });
    if (!cn) throw new NotFoundException('Avoir introuvable');
    return cn;
  }

  /**
   * Look up a store-credit avoir by code for POS redemption (validate + show
   * balance before adding it as a tender). Returns a lean, spendable view.
   */
  async lookupSpendable(
    code: string,
    storeId: string,
  ): Promise<{ code: string; type: string; status: string; remainingMinorUnits: number; spendable: boolean }> {
    const cn = await this.cnRepo.findOne({ where: { code: code.trim().toUpperCase(), storeId } });
    if (!cn) throw new NotFoundException('Avoir introuvable');
    const spendable =
      cn.type === 'store_credit' &&
      (cn.status === 'active' || cn.status === 'partially_redeemed') &&
      cn.remainingMinorUnits > 0;
    return {
      code: cn.code,
      type: cn.type,
      status: cn.status,
      remainingMinorUnits: cn.remainingMinorUnits,
      spendable,
    };
  }

  /** Returns the returnable quantity per line for a sale (for the POS return UI). */
  async getReturnableForSale(saleId: string, storeId: string): Promise<{
    sale: SaleEntity;
    lines: { lineItemId: string; productName: string; ean: string; soldQty: number; returnedQty: number; returnableQty: number; unitPriceMinorUnits: number; lineTotalMinorUnits: number }[];
  }> {
    const sale = await this.saleRepo.findOne({ where: { id: saleId, storeId } });
    if (!sale) throw new NotFoundException('Vente introuvable');
    const returned = await this.getReturnedQuantities(saleId);
    const lines = (sale.lineItems || []).map((li) => ({
      lineItemId: li.id,
      productName: li.productName,
      ean: li.ean,
      soldQty: li.quantity,
      returnedQty: returned[li.id] || 0,
      returnableQty: li.quantity - (returned[li.id] || 0),
      unitPriceMinorUnits: li.unitPriceMinorUnits,
      lineTotalMinorUnits: li.lineTotalMinorUnits,
    }));
    return { sale, lines };
  }
}
