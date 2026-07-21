import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SaleEntity } from '../../database/entities/sale.entity';
import { StoreEntity } from '../../database/entities/store.entity';
import { CreditNoteEntity } from '../../database/entities/credit-note.entity';
import { ProductEntity } from '../../database/entities/product.entity';
import { PdfService } from '../documents/pdf.service';
import { computeVatBreakdown, VatBreakdownRow } from './vat-breakdown.util';

/**
 * Jeton public : base64url de 24 octets aléatoires (32 chars). On tolère
 * 16-64 chars pour rester compatible avec une évolution de longueur, mais
 * JAMAIS un autre alphabet — coupe court aux injections et aux scans exotiques.
 */
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** Libellés humains des moyens de paiement (aucune donnée bancaire). */
export const PAYMENT_LABELS: Record<string, string> = {
  card: 'Carte bancaire',
  cash: 'Espèces',
  voucher: 'Titre-resto',
  gift_card: 'Carte cadeau',
  store_credit: 'Avoir',
  mixed: 'Mixte',
};

export interface PublicTicketData {
  ticketNumber: string;
  date: Date;
  status: 'completed' | 'payment_pending' | 'voided' | string;
  currencyCode: string;
  store: {
    name: string;
    operatingCompanyName: string | null;
    address: string | null;
    addressExtra: string | null;
    postalCode: string | null;
    city: string | null;
    phone: string | null;
    email: string | null;
    websiteUrl: string | null;
    siret: string | null;
    rcs: string | null;
    tvaIntracom: string | null;
    logoUrl: string | null;
    timezone: string;
  };
  items: {
    name: string;
    quantity: number;
    unitPriceMinorUnits: number;
    discountMinorUnits: number;
    lineTotalMinorUnits: number;
    taxRate: number;
  }[];
  payments: { method: string; label: string; amountMinorUnits: number }[];
  subtotalMinorUnits: number;
  discountTotalMinorUnits: number;
  taxTotalMinorUnits: number;
  totalMinorUnits: number;
  vatBreakdown: VatBreakdownRow[];
  cashier: string;
  /** Avoirs / remboursements rattachés à CETTE vente (statut affiché, vente jamais réécrite). */
  creditNotes: { code: string; type: string; totalMinorUnits: number; createdAt: Date }[];
  recommendations: {
    enabled: boolean;
    target: string | null;
    websiteUrl: string | null;
    items: { name: string; imageUrl: string | null; priceMinorUnits: number; oldPriceMinorUnits: number | null }[];
  };
}

@Injectable()
export class PublicTicketService {
  private readonly logger = new Logger('PublicTicket');

  constructor(
    @InjectRepository(SaleEntity) private saleRepo: Repository<SaleEntity>,
    @InjectRepository(StoreEntity) private storeRepo: Repository<StoreEntity>,
    @InjectRepository(CreditNoteEntity) private cnRepo: Repository<CreditNoteEntity>,
    @InjectRepository(ProductEntity) private productRepo: Repository<ProductEntity>,
    private readonly pdf: PdfService,
  ) {}

  /**
   * Résout un jeton public → données du ticket numérique. 404 opaque (même
   * message pour « format invalide » et « inconnu » : rien à énumérer).
   * Journalise la consultation SANS donnée personnelle (ni IP, ni user-agent).
   */
  async getTicketByToken(token: string): Promise<PublicTicketData> {
    if (!TOKEN_RE.test(token || '')) throw new NotFoundException('Ticket introuvable');

    const sale = await this.saleRepo.findOne({ where: { publicToken: token } });
    if (!sale) throw new NotFoundException('Ticket introuvable');

    const store = await this.storeRepo.findOne({ where: { id: sale.storeId } });
    const creditNotes = await this.cnRepo.find({
      where: { originalSaleId: sale.id },
      order: { createdAt: 'ASC' },
    });

    // Consultation journalisée sans PII : jeton tronqué + n° de ticket.
    this.logger.log(`[TICKET_VIEW] ${sale.ticketNumber} (token ${token.slice(0, 8)}…)`);

    const recommendations = await this.buildRecommendations(store);

    return {
      ticketNumber: sale.ticketNumber,
      date: sale.completedAt ?? sale.createdAt,
      status: sale.status,
      currencyCode: sale.currencyCode || 'EUR',
      store: {
        name: store?.name || 'Magasin',
        operatingCompanyName: store?.operatingCompanyName ?? null,
        address: store?.address || null,
        addressExtra: store?.addressExtra ?? null,
        postalCode: store?.postalCode || null,
        city: store?.city || null,
        phone: store?.phone || null,
        email: store?.email || null,
        websiteUrl: store?.websiteUrl ?? null,
        siret: store?.siret || null,
        rcs: store?.rcs || null,
        tvaIntracom: store?.tvaIntracom || null,
        logoUrl: store?.receiptLogoUrl ?? null,
        timezone: store?.timezone || 'Europe/Paris',
      },
      items: (sale.lineItems || []).map((li) => ({
        name: li.productName || 'Produit',
        quantity: li.quantity,
        unitPriceMinorUnits: li.unitPriceMinorUnits,
        discountMinorUnits: li.discountMinorUnits || 0,
        lineTotalMinorUnits: li.lineTotalMinorUnits,
        taxRate: typeof li.taxRate === 'string' ? parseFloat(li.taxRate) : li.taxRate,
      })),
      payments: (sale.payments || []).map((p) => ({
        method: p.method,
        label: PAYMENT_LABELS[p.method] ?? p.method,
        amountMinorUnits: p.amountMinorUnits,
      })),
      subtotalMinorUnits: sale.subtotalMinorUnits,
      discountTotalMinorUnits: sale.discountTotalMinorUnits || 0,
      taxTotalMinorUnits: sale.taxTotalMinorUnits,
      totalMinorUnits: sale.totalMinorUnits,
      vatBreakdown: computeVatBreakdown(sale.lineItems || []),
      cashier: sale.employeeNameSnapshot || '',
      creditNotes: creditNotes.map((cn) => ({
        code: cn.code,
        type: cn.type,
        totalMinorUnits: cn.totalMinorUnits,
        createdAt: cn.createdAt,
      })),
      recommendations,
    };
  }

  /**
   * PDF téléchargeable du ticket numérique — rendu verbatim des montants
   * scellés (PdfService, bandeau DUPLICATA : un ré-émis n'est jamais
   * l'original). Aucune écriture.
   */
  async getTicketPdf(token: string): Promise<{ filename: string; bytes: Uint8Array }> {
    if (!TOKEN_RE.test(token || '')) throw new NotFoundException('Ticket introuvable');
    const sale = await this.saleRepo.findOne({ where: { publicToken: token } });
    if (!sale) throw new NotFoundException('Ticket introuvable');
    const store = await this.storeRepo.findOne({ where: { id: sale.storeId } });

    const bytes = await this.pdf.renderSaleDuplicata({
      storeName: store?.name || 'Magasin',
      storeAddress: [store?.address, store?.postalCode, store?.city].filter(Boolean).join(', ') || undefined,
      siret: store?.siret || undefined,
      tvaIntracom: store?.tvaIntracom || undefined,
      ticketNumber: sale.ticketNumber,
      createdAt: sale.completedAt ?? sale.createdAt,
      employeeName: sale.employeeNameSnapshot || undefined,
      currencyCode: sale.currencyCode || 'EUR',
      lines: (sale.lineItems || []).map((li) => ({
        productName: li.productName || 'Produit',
        quantity: li.quantity,
        unitPriceMinorUnits: li.unitPriceMinorUnits,
        lineTotalMinorUnits: li.lineTotalMinorUnits,
        taxRate: typeof li.taxRate === 'string' ? parseFloat(li.taxRate) : li.taxRate,
      })),
      subtotalMinorUnits: sale.subtotalMinorUnits,
      discountTotalMinorUnits: sale.discountTotalMinorUnits || 0,
      taxTotalMinorUnits: sale.taxTotalMinorUnits,
      totalMinorUnits: sale.totalMinorUnits,
      payments: (sale.payments || []).map((p) => ({
        method: PAYMENT_LABELS[p.method] ?? p.method,
        amountMinorUnits: p.amountMinorUnits,
      })),
      hashChainCurrent: sale.hashChainCurrent || undefined,
      footerMessage: store?.footerMessage || undefined,
    });

    this.logger.log(`[TICKET_PDF] ${sale.ticketNumber} (token ${token.slice(0, 8)}…)`);
    return { filename: `ticket-${sale.ticketNumber}.pdf`, bytes };
  }

  /**
   * Recommandations : UNIQUEMENT le catalogue réel du magasin (jamais de faux
   * produits). Désactivées (liste vide) si le magasin ne les a pas activées.
   */
  private async buildRecommendations(store: StoreEntity | null): Promise<PublicTicketData['recommendations']> {
    const disabled = {
      enabled: false,
      target: null,
      websiteUrl: store?.websiteUrl ?? null,
      items: [] as PublicTicketData['recommendations']['items'],
    };
    if (!store || !store.receiptShowRecommendations) return disabled;

    const target = store.receiptRecommendationTarget || 'new';
    const where: Record<string, unknown> = { storeId: store.id, isActive: true };
    if (target === 'category' && store.receiptRecommendationCategoryId) {
      where.categoryId = store.receiptRecommendationCategoryId;
    }
    const products = await this.productRepo.find({
      where: where as never,
      order: { createdAt: 'DESC' },
      take: 6,
    });

    return {
      enabled: true,
      target,
      websiteUrl: store.websiteUrl ?? null,
      items: products.map((p) => ({
        name: p.name,
        imageUrl: p.imageUrl || null,
        priceMinorUnits: p.priceMinorUnits,
        oldPriceMinorUnits: p.oldPriceMinorUnits ?? null,
      })),
    };
  }
}
