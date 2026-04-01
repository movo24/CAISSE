import { Controller, Get, Param, NotFoundException, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SaleEntity } from '../../database/entities/sale.entity';
import { SaleLineItemEntity } from '../../database/entities/sale-line-item.entity';
import { SalePaymentEntity } from '../../database/entities/sale-payment.entity';
import { StoreEntity } from '../../database/entities/store.entity';
import { SkipTenantCheck } from '../../common/interceptors/tenant.interceptor';

/** Escape HTML to prevent XSS — all user-controlled data must pass through this */
function esc(str: string | null | undefined): string {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

/**
 * Public receipt endpoint — no auth required.
 * Customers scan QR code → see their receipt on a mobile-friendly page.
 * Security: receipts are accessed by sale UUID (unguessable).
 */
@ApiTags('receipts')
@Controller('receipts')
export class ReceiptsController {
  private readonly logger = new Logger('Receipts');

  constructor(
    @InjectRepository(SaleEntity) private saleRepo: Repository<SaleEntity>,
    @InjectRepository(SaleLineItemEntity) private lineRepo: Repository<SaleLineItemEntity>,
    @InjectRepository(SalePaymentEntity) private payRepo: Repository<SalePaymentEntity>,
    @InjectRepository(StoreEntity) private storeRepo: Repository<StoreEntity>,
  ) {}

  /**
   * GET /api/receipts/:saleId
   * Public — returns receipt data as JSON for the mobile web page.
   */
  @Get(':saleId')
  @SkipTenantCheck()
  @ApiOperation({ summary: 'Get digital receipt for a sale (public, no auth)' })
  async getReceipt(@Param('saleId') saleId: string) {
    // Validate UUID format to avoid PostgreSQL error on invalid IDs
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(saleId)) throw new NotFoundException('Reçu introuvable');

    const sale = await this.saleRepo.findOne({ where: { id: saleId } });
    if (!sale) throw new NotFoundException('Reçu introuvable');

    const lineItems = await this.lineRepo.find({ where: { saleId: sale.id } });
    const payments = await this.payRepo.find({ where: { saleId: sale.id } });
    const store = await this.storeRepo.findOne({ where: { id: sale.storeId } });

    this.logger.log(`[RECEIPT] Accessed: ${sale.ticketNumber} (sale ${saleId.slice(0, 8)})`);

    return {
      ticketNumber: sale.ticketNumber,
      date: sale.createdAt,
      store: {
        name: store?.name || 'Magasin',
        address: store?.address || '',
        city: store?.city || '',
        siret: store?.siret || '',
        tvaIntracom: store?.tvaIntracom || '',
      },
      items: lineItems.map((li) => ({
        name: li.productName || 'Produit',
        quantity: li.quantity,
        unitPrice: li.unitPriceMinorUnits / 100,
        total: li.lineTotalMinorUnits / 100,
      })),
      payments: payments.map((p) => ({
        method: p.method === 'card' ? 'Carte bancaire' : p.method === 'cash' ? 'Espèces' : 'Mixte',
        amount: p.amountMinorUnits / 100,
      })),
      subtotal: sale.subtotalMinorUnits / 100,
      discount: (sale.discountTotalMinorUnits || 0) / 100,
      total: sale.totalMinorUnits / 100,
      taxRate: 20,
      cashier: sale.employeeNameSnapshot || '',
    };
  }

  /**
   * GET /api/receipts/:saleId/html
   * Returns a self-contained HTML page (mobile-friendly receipt).
   */
  @Get(':saleId/html')
  @SkipTenantCheck()
  @ApiOperation({ summary: 'Get digital receipt as HTML page (public)' })
  async getReceiptHtml(@Param('saleId') saleId: string) {
    const data = await this.getReceipt(saleId);

    const itemsHtml = data.items.map((i: any) =>
      `<tr><td>${esc(i.name)}</td><td style="text-align:center">${i.quantity}</td><td style="text-align:right">${i.unitPrice.toFixed(2)} €</td><td style="text-align:right">${i.total.toFixed(2)} €</td></tr>`
    ).join('');

    const paymentsHtml = data.payments.map((p: any) =>
      `<div style="display:flex;justify-content:space-between"><span>${esc(p.method)}</span><span>${p.amount.toFixed(2)} €</span></div>`
    ).join('');

    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reçu ${data.ticketNumber}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;color:#1a1a1a;padding:16px}
.receipt{max-width:400px;margin:0 auto;background:#fff;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,.08);overflow:hidden}
.header{background:linear-gradient(135deg,#059669,#10b981);color:#fff;padding:24px;text-align:center}
.header h1{font-size:14px;opacity:.8;letter-spacing:2px;text-transform:uppercase}
.header .total{font-size:36px;font-weight:900;margin:8px 0}
.header .ticket{font-size:12px;opacity:.7}
.body{padding:20px}
.store{text-align:center;margin-bottom:16px;padding-bottom:16px;border-bottom:1px dashed #e5e5e5}
.store h2{font-size:16px;font-weight:700}
.store p{font-size:11px;color:#666;margin-top:2px}
table{width:100%;border-collapse:collapse;margin:12px 0}
th{font-size:10px;color:#999;text-transform:uppercase;letter-spacing:1px;padding:4px 0;border-bottom:1px solid #eee;text-align:left}
td{padding:8px 0;font-size:13px;border-bottom:1px solid #f5f5f5}
.payments{margin:16px 0;padding:12px;background:#f9f9f9;border-radius:8px;font-size:13px}
.total-line{display:flex;justify-content:space-between;font-size:18px;font-weight:800;margin-top:12px;padding-top:12px;border-top:2px solid #1a1a1a}
.footer{text-align:center;padding:16px;font-size:10px;color:#999;border-top:1px solid #f0f0f0}
.badge{display:inline-block;background:#059669;color:#fff;font-size:10px;font-weight:700;padding:4px 10px;border-radius:20px;margin-top:8px}
</style>
</head>
<body>
<div class="receipt">
<div class="header">
<h1>Reçu de paiement</h1>
<div class="total">${data.total.toFixed(2)} €</div>
<div class="ticket">${esc(data.ticketNumber)} • ${new Date(data.date).toLocaleString('fr-FR')}</div>
<div class="badge">✓ Payé</div>
</div>
<div class="body">
<div class="store">
<h2>${esc(data.store.name)}</h2>
<p>${esc(data.store.address)}${data.store.city ? ', ' + esc(data.store.city) : ''}</p>
${data.store.siret ? `<p>SIRET: ${esc(data.store.siret)}</p>` : ''}
</div>
<table>
<thead><tr><th>Article</th><th style="text-align:center">Qté</th><th style="text-align:right">P.U.</th><th style="text-align:right">Total</th></tr></thead>
<tbody>${itemsHtml}</tbody>
</table>
${data.discount > 0 ? `<div style="display:flex;justify-content:space-between;color:#059669;font-size:13px"><span>Remise</span><span>-${data.discount.toFixed(2)} €</span></div>` : ''}
<div class="payments">${paymentsHtml}</div>
<div class="total-line"><span>TOTAL TTC</span><span>${data.total.toFixed(2)} €</span></div>
<p style="font-size:11px;color:#999;margin-top:8px;text-align:center">TVA ${data.taxRate}% incluse</p>
</div>
<div class="footer">
<p>Merci de votre visite !</p>
<p style="margin-top:4px">${esc(data.store.name)} • ${new Date(data.date).toLocaleDateString('fr-FR')}</p>
</div>
</div>
</body>
</html>`;
  }
}
