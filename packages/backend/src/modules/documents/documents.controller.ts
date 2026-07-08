import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Request, Res, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { PdfService } from './pdf.service';
import { SalesService } from '../sales/sales.service';
import { ReturnsService } from '../returns/returns.service';
import { ReportsService } from '../reports/reports.service';
import { StoreEntity } from '../../database/entities/store.entity';

/**
 * Documents PDF (PR #31) — expose enfin le PdfService (duplicata / justificatif
 * d'avoir / export Z) resté sans route réseau.
 *
 * RÈGLE FISCALE STRICTE (héritée de PdfService) : ces endpoints sont des
 * *lectures + rendus*. Les données viennent FIGÉES des services métier
 * tenant-scopés (vente validée, avoir chaîné, Z scellé) et sont imprimées
 * verbatim — aucun recalcul, aucune écriture. L'export Z LIT un Z existant
 * (404 sinon) et ne déclenche JAMAIS une génération.
 */
@ApiTags('documents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly pdf: PdfService,
    private readonly sales: SalesService,
    private readonly returns: ReturnsService,
    private readonly reports: ReportsService,
    @InjectRepository(StoreEntity)
    private readonly storeRepo: Repository<StoreEntity>,
  ) {}

  private sendPdf(res: Response, bytes: Uint8Array, filename: string): void {
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Content-Length': String(bytes.length),
    });
    res.send(Buffer.from(bytes));
  }

  @Get('sales/:id/duplicata')
  @ApiOperation({ summary: 'Duplicata PDF d\'un ticket validé (rendu verbatim, tenant-scoped)' })
  async saleDuplicata(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Res() res: Response,
  ) {
    const sale = await this.sales.findOne(id, req.user.storeId); // 404 si hors magasin
    const store = await this.storeRepo.findOne({ where: { id: req.user.storeId } });
    const bytes = await this.pdf.renderSaleDuplicata({
      storeName: store?.name || 'CAISSE',
      storeAddress: store?.address || undefined,
      siret: store?.siret || undefined,
      tvaIntracom: store?.tvaIntracom || undefined,
      ticketNumber: sale.ticketNumber,
      createdAt: sale.createdAt,
      employeeName: sale.employeeNameSnapshot || undefined,
      currencyCode: store?.currencyCode || 'EUR',
      lines: (sale.lineItems || []).map((li) => ({
        productName: li.productName,
        quantity: li.quantity,
        unitPriceMinorUnits: li.unitPriceMinorUnits,
        lineTotalMinorUnits: li.lineTotalMinorUnits,
        taxRate: li.taxRate != null ? Number(li.taxRate) : undefined,
      })),
      // Totaux FIGÉS de la vente — imprimés tels quels, jamais recalculés.
      subtotalMinorUnits: sale.subtotalMinorUnits,
      discountTotalMinorUnits: sale.discountTotalMinorUnits,
      taxTotalMinorUnits: sale.taxTotalMinorUnits,
      totalMinorUnits: sale.totalMinorUnits,
      payments: (sale.payments || []).map((p) => ({ method: p.method, amountMinorUnits: p.amountMinorUnits })),
      hashChainCurrent: sale.hashChainCurrent || undefined,
    });
    this.sendPdf(res, bytes, `duplicata-${sale.ticketNumber}.pdf`);
  }

  @Get('credit-notes/:id/justificatif')
  @ApiOperation({ summary: 'Justificatif PDF d\'un avoir (rendu verbatim, tenant-scoped)' })
  async creditNoteJustificatif(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Res() res: Response,
  ) {
    const cn = await this.returns.findOne(id, req.user.storeId); // 404 si hors magasin
    const store = await this.storeRepo.findOne({ where: { id: req.user.storeId } });
    const bytes = await this.pdf.renderCreditNoteJustificatif({
      storeName: store?.name || 'CAISSE',
      number: cn.code,
      origin: cn.origin,
      originalTicketNumber: cn.originalTicketNumber,
      createdAt: cn.createdAt,
      currencyCode: cn.currencyCode || 'EUR',
      totalMinorUnits: cn.totalMinorUnits,
      remainingMinorUnits: cn.remainingMinorUnits,
      refundMethod: cn.refundMethod,
      reason: cn.reason,
      hashChainCurrent: cn.hashChainCurrent,
    });
    this.sendPdf(res, bytes, `avoir-${cn.code}.pdf`);
  }

  @Get('z-reports/:date')
  @Roles('admin', 'manager')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Export PDF d\'un Z-report EXISTANT (lecture seule — jamais de génération)' })
  async zReport(
    @Param('date') date: string,
    @Request() req: any,
    @Res() res: Response,
  ) {
    // LIT le Z scellé — 404 s'il n'a pas été généré (jamais de génération implicite).
    const z = await this.reports.getZReport(req.user.storeId, date);
    if (!z) throw new NotFoundException(`Aucun Z-report pour le ${date}`);
    const store = await this.storeRepo.findOne({ where: { id: req.user.storeId } });
    const bytes = await this.pdf.renderZReport({
      storeName: store?.name || 'CAISSE',
      date: z.date,
      transactionCount: z.transactionCount,
      currencyCode: z.currencyCode || 'EUR',
      totalRevenueMinorUnits: z.totalRevenueMinorUnits,
      totalTaxMinorUnits: z.totalTaxMinorUnits,
      discountTotalMinorUnits: z.discountTotalMinorUnits,
      cashTotalMinorUnits: z.cashTotalMinorUnits,
      cardTotalMinorUnits: z.cardTotalMinorUnits,
      averageBasketMinorUnits: z.averageBasketMinorUnits ?? undefined,
    });
    this.sendPdf(res, bytes, `z-report-${z.date}.pdf`);
  }
}
