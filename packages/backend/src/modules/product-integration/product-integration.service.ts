import { Injectable, Logger, HttpStatus, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { ProductEntity } from '../../database/entities/product.entity';
import { EmployeeEntity } from '../../database/entities/employee.entity';
import { SaleLineItemEntity } from '../../database/entities/sale-line-item.entity';
import { ProductIntegrationRequestEntity } from '../../database/entities/product-integration-request.entity';
import { BusinessError } from '../../common/errors/business-error';
import { AuditService } from '../audit/audit.service';
import { ProductsService } from '../products/products.service';
import { EmployeeScoreService } from '../employee-score/employee-score.service';
import { hasMinRole } from '../../common/guards/permissions';
import {
  CreateIntegrationRequestDto,
  CreateSecuredProductDto,
  ApproveIntegrationRequestDto,
  IntegrationSource,
  ProductStatus,
} from '../../common/dto/product-integration.dto';

/** Résultat d'une vérification de code opérateur. */
export interface OperatorAuthorization {
  employeeId: string;
  name: string;
  role: string;
  /** Peut activer directement un produit (admin / responsable). */
  canActivate: boolean;
  /** Comment l'autorisation a été obtenue. */
  via: 'session' | 'pin';
}

/**
 * Intégration produit — workflow "code-barres inconnu".
 *
 * Règles métier (immuables) :
 *  - la caisse ne crée JAMAIS de produit : elle ne peut créer qu'une DEMANDE ;
 *  - toute création de fiche exige une autorisation opérationnelle
 *    (session manager/admin OU code PIN d'un employé autorisé) ;
 *  - anti-doublon strict par code-barres exact (et SKU) avant toute création ;
 *  - chaque scan inconnu / demande / création / refus est journalisé dans la
 *    chaîne d'audit.
 */
@Injectable()
export class ProductIntegrationService {
  private readonly logger = new Logger(ProductIntegrationService.name);

  constructor(
    @InjectRepository(ProductIntegrationRequestEntity)
    private requestRepo: Repository<ProductIntegrationRequestEntity>,
    @InjectRepository(ProductEntity)
    private productRepo: Repository<ProductEntity>,
    @InjectRepository(EmployeeEntity)
    private employeeRepo: Repository<EmployeeEntity>,
    @InjectRepository(SaleLineItemEntity)
    private saleLineRepo: Repository<SaleLineItemEntity>,
    private auditService: AuditService,
    private productsService: ProductsService,
    // Optionnel : le score ne doit jamais bloquer un flux d'intégration produit.
    @Optional() private scoreService?: EmployeeScoreService,
  ) {}

  /** Émet un fait de score signé (best-effort, jamais bloquant). */
  private emitScore(input: {
    employeeId: string;
    storeId: string;
    eventType: string;
    terminalId?: string | null;
    reason?: string;
    source?: string;
  }): void {
    this.scoreService
      ?.logEvent({ ...input, source: input.source ?? 'pos' })
      .catch(() => undefined);
  }

  // ── Scan lookup ────────────────────────────────────────────────

  /**
   * Recherche un code-barres dans le magasin. Produit trouvé (quel que soit
   * son statut) → fiche + stock + prix (+ dernières ventes). Inconnu → journal
   * `scan_unknown` + demande en attente éventuelle.
   */
  async scan(
    storeId: string,
    employeeId: string,
    barcode: string,
    source: IntegrationSource,
    terminalId?: string,
  ) {
    const normalized = barcode.trim();
    const product = await this.productRepo.findOne({
      where: { ean: normalized, storeId },
    });

    if (product) {
      const lastSales = await this.getLastSales(product.id);
      return {
        found: true as const,
        product,
        stockQuantity: product.stockQuantity,
        priceMinorUnits: product.priceMinorUnits,
        storeId,
        lastSales,
      };
    }

    const pendingRequest = await this.requestRepo.findOne({
      where: { storeId, barcode: normalized, status: 'pending' },
    });

    await this.auditService.log({
      storeId,
      employeeId,
      action: 'scan_unknown',
      entityType: 'product_integration',
      entityId: normalized,
      details: {
        barcode: normalized,
        source,
        terminalId: terminalId ?? null,
        result: 'not_found',
        pendingRequestId: pendingRequest?.id ?? null,
      },
    });

    // Fait de score : code-barres inconnu scanné (neutre — trace d'activité).
    this.emitScore({
      employeeId,
      storeId,
      eventType: 'UNKNOWN_BARCODE_SCANNED',
      terminalId: terminalId ?? null,
      reason: `Code-barres inconnu ${normalized}`,
      source,
    });

    return {
      found: false as const,
      barcode: normalized,
      pendingRequest,
      message:
        'Produit inconnu. La création produit doit être faite depuis le Dashboard ou le module Inventaire.',
    };
  }

  private async getLastSales(productId: string) {
    try {
      const rows = await this.saleLineRepo
        .createQueryBuilder('li')
        .innerJoin('li.sale', 's')
        .where('li.product_id = :productId', { productId })
        .orderBy('s.created_at', 'DESC')
        .take(5)
        .select([
          'li.quantity AS quantity',
          'li.unit_price_minor_units AS "unitPriceMinorUnits"',
          's.created_at AS "soldAt"',
        ])
        .getRawMany();
      return rows;
    } catch {
      return []; // "si disponible" — jamais bloquant pour le scan
    }
  }

  // ── Autorisation opérateur (RÈGLE 4) ───────────────────────────

  /**
   * Vérifie un code PIN opérateur pour le magasin. Seul un employé actif de
   * rôle manager/admin est autorisé à créer/activer une fiche produit.
   * Code invalide ou rôle insuffisant → 403 « Autorisation insuffisante » +
   * tentative journalisée.
   */
  async verifyOperatorPin(
    storeId: string,
    requesterEmployeeId: string,
    pin: string,
    context: Record<string, unknown> = {},
  ): Promise<OperatorAuthorization> {
    // pinHash is select:false — opt in explicitly to compare the operator PIN.
    const employees = await this.employeeRepo
      .createQueryBuilder('e')
      .where('e.storeId = :storeId', { storeId })
      .andWhere('e.isActive = true')
      .addSelect('e.pinHash')
      .getMany();

    let matched: EmployeeEntity | null = null;
    for (const emp of employees) {
      if (emp.pinHash && (await bcrypt.compare(pin, emp.pinHash))) {
        matched = emp;
        break;
      }
    }

    if (!matched) {
      await this.logDenied(storeId, requesterEmployeeId, 'invalid_pin', context);
      throw new BusinessError(
        'PRODUCT_CREATE_UNAUTHORIZED',
        'Autorisation insuffisante',
        HttpStatus.FORBIDDEN,
      );
    }

    if (!hasMinRole(matched.role, 'manager')) {
      await this.logDenied(storeId, requesterEmployeeId, 'insufficient_role', {
        ...context,
        matchedEmployeeId: matched.id,
        matchedRole: matched.role,
      });
      throw new BusinessError(
        'PRODUCT_CREATE_UNAUTHORIZED',
        'Autorisation insuffisante',
        HttpStatus.FORBIDDEN,
      );
    }

    return {
      employeeId: matched.id,
      name: `${matched.firstName} ${matched.lastName}`.trim(),
      role: matched.role,
      canActivate: hasMinRole(matched.role, 'manager'),
      via: 'pin',
    };
  }

  private async logDenied(
    storeId: string,
    employeeId: string,
    reason: string,
    context: Record<string, unknown>,
  ) {
    await this.auditService.log({
      storeId,
      employeeId,
      action: 'product_creation_denied',
      entityType: 'product_integration',
      entityId: (context.barcode as string) || 'unknown',
      details: { ...context, result: 'denied', reason },
    });
  }

  /**
   * Résout l'autorisation d'une création de fiche : session manager/admin
   * suffit ; sinon un PIN opérateur autorisé est OBLIGATOIRE.
   */
  private async resolveAuthorization(
    storeId: string,
    requester: { employeeId: string; role: string },
    pin: string | undefined,
    context: Record<string, unknown>,
  ): Promise<OperatorAuthorization> {
    if (hasMinRole(requester.role, 'manager')) {
      return {
        employeeId: requester.employeeId,
        name: '',
        role: requester.role,
        canActivate: true,
        via: 'session',
      };
    }
    if (pin) {
      return this.verifyOperatorPin(storeId, requester.employeeId, pin, context);
    }
    await this.logDenied(storeId, requester.employeeId, 'no_authorization', context);
    throw new BusinessError(
      'PRODUCT_CREATE_UNAUTHORIZED',
      'Autorisation insuffisante',
      HttpStatus.FORBIDDEN,
    );
  }

  // ── Anti-doublon (RÈGLE 6) ─────────────────────────────────────

  /**
   * Doublon strict : code-barres exact (tout statut confondu) ou SKU exact.
   * Bloque avec 409 + fiche existante. Le nom proche n'est qu'un avertissement.
   */
  private async assertNoDuplicate(
    storeId: string,
    ean: string,
    sku?: string,
  ): Promise<void> {
    const byEan = await this.productRepo.findOne({ where: { ean, storeId } });
    if (byEan) {
      throw new BusinessError(
        'PRODUCT_BARCODE_ALREADY_EXISTS',
        `Un produit existe déjà avec ce code-barres (${ean}) : ${byEan.name}.`,
        HttpStatus.CONFLICT,
        {
          existingProduct: {
            id: byEan.id,
            name: byEan.name,
            ean: byEan.ean,
            status: byEan.status,
            isActive: byEan.isActive,
          },
        },
      );
    }
    if (sku) {
      const bySku = await this.productRepo.findOne({ where: { sku, storeId } });
      if (bySku) {
        throw new BusinessError(
          'PRODUCT_SKU_ALREADY_EXISTS',
          `Un produit existe déjà avec ce SKU (${sku}) : ${bySku.name}.`,
          HttpStatus.CONFLICT,
          {
            existingProduct: {
              id: bySku.id,
              name: bySku.name,
              ean: bySku.ean,
              status: bySku.status,
            },
          },
        );
      }
    }
  }

  /** Noms proches (non bloquant) — retourné comme avertissement. */
  private async findSimilarByName(storeId: string, name?: string) {
    if (!name || name.trim().length < 3) return [];
    const rows = await this.productRepo
      .createQueryBuilder('p')
      .where('p.store_id = :storeId', { storeId })
      .andWhere('p.name ILIKE :name', { name: `%${name.trim()}%` })
      .take(5)
      .getMany();
    return rows.map((p) => ({ id: p.id, name: p.name, ean: p.ean, status: p.status }));
  }

  // ── Demandes d'intégration ─────────────────────────────────────

  /**
   * Crée une demande d'intégration produit (seule action autorisée depuis la
   * caisse). Idempotent par (magasin, code-barres) tant qu'une demande est en
   * attente. Bloque si le produit existe déjà (anti-doublon).
   */
  async createRequest(
    storeId: string,
    employeeId: string,
    dto: CreateIntegrationRequestDto,
  ): Promise<{ request: ProductIntegrationRequestEntity; alreadyPending: boolean }> {
    const barcode = dto.barcode.trim();

    const existing = await this.productRepo.findOne({ where: { ean: barcode, storeId } });
    if (existing) {
      // Tentative de doublon bloquée — fait de score signé.
      this.emitScore({
        employeeId,
        storeId,
        eventType: 'PRODUCT_DUPLICATE_BLOCKED',
        terminalId: dto.terminalId ?? null,
        reason: `Doublon code-barres ${barcode} (${existing.name})`,
        source: dto.source,
      });
      throw new BusinessError(
        'PRODUCT_BARCODE_ALREADY_EXISTS',
        `Un produit existe déjà avec ce code-barres (${barcode}) : ${existing.name}.`,
        HttpStatus.CONFLICT,
        { existingProduct: { id: existing.id, name: existing.name, status: existing.status } },
      );
    }

    const pending = await this.requestRepo.findOne({
      where: { storeId, barcode, status: 'pending' },
    });
    if (pending) {
      return { request: pending, alreadyPending: true };
    }

    const request = await this.requestRepo.save(
      this.requestRepo.create({
        storeId,
        barcode,
        source: dto.source,
        terminalId: dto.terminalId ?? null,
        requestedBy: employeeId,
        status: 'pending',
        proposal: dto.proposal ? { ...dto.proposal } : null,
        comment: dto.comment ?? null,
      }),
    );

    await this.auditService.log({
      storeId,
      employeeId,
      action: 'request_created',
      entityType: 'product_integration_request',
      entityId: request.id,
      details: {
        barcode,
        source: dto.source,
        terminalId: dto.terminalId ?? null,
        comment: dto.comment ?? null,
        result: 'pending',
      },
    });

    // Fait de score : demande d'intégration propre depuis la caisse (neutre).
    if (dto.source === 'pos') {
      this.emitScore({
        employeeId,
        storeId,
        eventType: 'PRODUCT_CREATION_REQUESTED_FROM_POS',
        terminalId: dto.terminalId ?? null,
        reason: `Demande d'intégration ${barcode}`,
        source: dto.source,
      });
    }

    return { request, alreadyPending: false };
  }

  async listRequests(
    storeId: string,
    status?: 'pending' | 'converted' | 'rejected',
  ): Promise<ProductIntegrationRequestEntity[]> {
    return this.requestRepo.find({
      where: status ? { storeId, status } : { storeId },
      order: { createdAt: 'DESC' },
      take: 200,
    });
  }

  // ── Création sécurisée de fiche produit (Dashboard / Inventaire) ─

  /**
   * Crée une fiche produit après autorisation opérationnelle.
   * Statut : `active` seulement si demandé ET autorisé (admin/responsable) ;
   * sinon `pending_validation`.
   */
  async createProduct(
    storeId: string,
    requester: { employeeId: string; role: string },
    dto: CreateSecuredProductDto,
  ) {
    const ean = dto.ean.trim();
    const authorization = await this.resolveAuthorization(
      storeId,
      requester,
      dto.pin,
      { barcode: ean, action: 'create_product' },
    );

    await this.assertNoDuplicate(storeId, ean, dto.sku?.trim());
    const similar = await this.findSimilarByName(storeId, dto.name);

    const status: ProductStatus =
      dto.activate && authorization.canActivate ? 'active' : 'pending_validation';

    // Marque / fournisseur par nom (réutilise le get-or-create existant)
    const brand = dto.brandName
      ? await this.productsService.getOrCreateBrand(storeId, dto.brandName)
      : null;
    const supplier = dto.supplierName
      ? await this.productsService.getOrCreateSupplier(storeId, dto.supplierName)
      : null;

    const product = await this.productRepo.save(
      this.productRepo.create({
        ean,
        name: dto.name.trim(),
        storeId,
        priceMinorUnits: dto.priceMinorUnits,
        costMinorUnits: dto.costMinorUnits,
        taxRate: dto.taxRate ?? 20,
        unitType: dto.unitType ?? 'unit',
        categoryId: dto.categoryId,
        brandId: brand?.id ?? null,
        supplierId: supplier?.id ?? null,
        imageUrl: dto.imageUrl ?? null,
        sku: dto.sku?.trim() || null,
        stockQuantity: dto.stockQuantity ?? 0,
        barcodeSource: 'manual',
        status,
        isActive: status === 'active',
      }),
    );

    await this.auditService.log({
      storeId,
      employeeId: requester.employeeId,
      action: 'product_created',
      entityType: 'product',
      entityId: product.id,
      details: {
        barcode: ean,
        name: product.name,
        status,
        authorizedBy: authorization.employeeId,
        authorizedVia: authorization.via,
        result: 'created',
      },
    });
    if (status === 'active') {
      await this.auditService.log({
        storeId,
        employeeId: requester.employeeId,
        action: 'product_activated',
        entityType: 'product',
        entityId: product.id,
        details: { barcode: ean, authorizedBy: authorization.employeeId, result: 'activated' },
      });
    }

    if (dto.requestId) {
      await this.markConverted(storeId, dto.requestId, requester.employeeId, product.id);
    } else {
      // La demande en attente pour ce code-barres (si elle existe) est convertie.
      const pending = await this.requestRepo.findOne({
        where: { storeId, barcode: ean, status: 'pending' },
      });
      if (pending) {
        await this.markConverted(storeId, pending.id, requester.employeeId, product.id);
      }
    }

    return { product, similarProducts: similar };
  }

  private async markConverted(
    storeId: string,
    requestId: string,
    employeeId: string,
    productId: string,
  ) {
    const request = await this.requestRepo.findOne({ where: { id: requestId, storeId } });
    if (!request || request.status !== 'pending') return;
    request.status = 'converted';
    request.decidedBy = employeeId;
    request.decidedAt = new Date();
    request.productId = productId;
    await this.requestRepo.save(request);
  }

  // ── Décision sur une demande (admin / responsable) ─────────────

  /** Approuve une demande → crée la fiche à partir de la proposition. */
  async approveRequest(
    storeId: string,
    requester: { employeeId: string; role: string },
    requestId: string,
    dto: ApproveIntegrationRequestDto,
  ) {
    const request = await this.requestRepo.findOne({ where: { id: requestId, storeId } });
    if (!request) throw BusinessError.notFound('Integration request', requestId);
    if (request.status !== 'pending') {
      throw new BusinessError(
        'INTEGRATION_REQUEST_ALREADY_DECIDED',
        'Cette demande a déjà été traitée.',
        HttpStatus.CONFLICT,
      );
    }

    const proposal = { ...(request.proposal ?? {}), ...(dto.overrides ?? {}) } as Record<
      string,
      any
    >;
    if (!proposal.name || proposal.priceMinorUnits == null) {
      throw new BusinessError(
        'INTEGRATION_REQUEST_INCOMPLETE',
        'Nom et prix de vente sont requis pour créer la fiche produit.',
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.createProduct(storeId, requester, {
      ean: request.barcode,
      name: proposal.name,
      priceMinorUnits: proposal.priceMinorUnits,
      costMinorUnits: proposal.costMinorUnits,
      taxRate: proposal.taxRate,
      unitType: proposal.unitType,
      brandName: proposal.brandName,
      supplierName: proposal.supplierName,
      imageUrl: proposal.imageUrl,
      sku: proposal.sku,
      stockQuantity: proposal.initialStock,
      activate: dto.activate !== false,
      requestId: request.id,
    });
  }

  /** Rejette une demande (journalisé avec raison). */
  async rejectRequest(
    storeId: string,
    employeeId: string,
    requestId: string,
    reason?: string,
  ): Promise<ProductIntegrationRequestEntity> {
    const request = await this.requestRepo.findOne({ where: { id: requestId, storeId } });
    if (!request) throw BusinessError.notFound('Integration request', requestId);
    if (request.status !== 'pending') {
      throw new BusinessError(
        'INTEGRATION_REQUEST_ALREADY_DECIDED',
        'Cette demande a déjà été traitée.',
        HttpStatus.CONFLICT,
      );
    }

    request.status = 'rejected';
    request.decidedBy = employeeId;
    request.decidedAt = new Date();
    request.rejectionReason = reason ?? null;
    const saved = await this.requestRepo.save(request);

    await this.auditService.log({
      storeId,
      employeeId,
      action: 'request_rejected',
      entityType: 'product_integration_request',
      entityId: request.id,
      details: { barcode: request.barcode, result: 'rejected', reason: reason ?? null },
    });

    return saved;
  }

  /** Produits en attente de validation (file de validation admin). */
  async listPendingProducts(storeId: string): Promise<ProductEntity[]> {
    return this.productRepo.find({
      where: { storeId, status: 'pending_validation' },
      order: { createdAt: 'DESC' },
      take: 200,
    });
  }

  // ── Validation d'un produit en attente ─────────────────────────

  /** Active un produit `pending_validation` (admin / responsable uniquement). */
  async activateProduct(
    storeId: string,
    requester: { employeeId: string; role: string },
    productId: string,
  ): Promise<ProductEntity> {
    const product = await this.productRepo.findOne({ where: { id: productId, storeId } });
    if (!product) throw BusinessError.notFound('Product', productId);
    if (product.status === 'active') return product;

    product.status = 'active';
    product.isActive = true;
    const saved = await this.productRepo.save(product);

    await this.auditService.log({
      storeId,
      employeeId: requester.employeeId,
      action: 'product_activated',
      entityType: 'product',
      entityId: product.id,
      details: { barcode: product.ean, result: 'activated' },
    });

    return saved;
  }

  /** Rejette un produit en attente de validation. */
  async rejectProduct(
    storeId: string,
    requester: { employeeId: string; role: string },
    productId: string,
    reason?: string,
  ): Promise<ProductEntity> {
    const product = await this.productRepo.findOne({ where: { id: productId, storeId } });
    if (!product) throw BusinessError.notFound('Product', productId);

    product.status = 'rejected';
    product.isActive = false;
    const saved = await this.productRepo.save(product);

    await this.auditService.log({
      storeId,
      employeeId: requester.employeeId,
      action: 'request_rejected',
      entityType: 'product',
      entityId: product.id,
      details: { barcode: product.ean, result: 'rejected', reason: reason ?? null },
    });

    return saved;
  }
}
