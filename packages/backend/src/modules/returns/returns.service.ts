import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createHash, randomBytes } from 'crypto';
import { CreditNoteEntity } from '../../database/entities/credit-note.entity';
import { CreditNoteLineEntity } from '../../database/entities/credit-note-line.entity';
import { SaleEntity } from '../../database/entities/sale.entity';
import { IdempotencyKeyEntity } from '../../database/entities/idempotency-key.entity';
import { AuditService } from '../audit/audit.service';
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
  ) {}

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

        // Per-store hash chain over credit notes.
        const lastCn = await qr.query(
          `SELECT hash_chain_current FROM credit_notes WHERE store_id = $1 ORDER BY created_at DESC LIMIT 1`,
          [storeId],
        );
        const prevHash = lastCn.length > 0 ? lastCn[0].hash_chain_current : GENESIS;
        const code = this.genCode();
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
        cn.lines = returnLines.map((l) => Object.assign(new CreditNoteLineEntity(), l));

        const saved = await qr.manager.save(CreditNoteEntity, cn);

        // Restore stock atomically.
        for (const l of returnLines) {
          await qr.query(
            `UPDATE products SET stock_quantity = stock_quantity + $1, updated_at = NOW() WHERE id = $2 AND store_id = $3`,
            [l.quantity, l.productId, storeId],
          );
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
            },
          })
          .catch((e: any) => this.logger.warn(`Audit (sale_returned) failed: ${e?.message}`));

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

  async listForStore(
    storeId: string,
    opts: { page?: number; limit?: number } = {},
  ): Promise<PaginatedResult<CreditNoteEntity>> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
    const page = Math.max(opts.page ?? 1, 1);
    const [data, total] = await this.cnRepo.findAndCount({
      where: { storeId },
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
