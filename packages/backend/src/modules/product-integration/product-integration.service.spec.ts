import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { ProductIntegrationService } from './product-integration.service';
import { ProductIntegrationRequestEntity } from '../../database/entities/product-integration-request.entity';
import { ProductEntity } from '../../database/entities/product.entity';
import { EmployeeEntity } from '../../database/entities/employee.entity';
import { SaleLineItemEntity } from '../../database/entities/sale-line-item.entity';
import { AuditService } from '../audit/audit.service';
import { ProductsService } from '../products/products.service';
import { EmployeeScoreService } from '../employee-score/employee-score.service';
import { BusinessError } from '../../common/errors/business-error';

const STORE = 'store-1';
const CASHIER = { employeeId: 'emp-cashier', role: 'cashier' };
const MANAGER = { employeeId: 'emp-manager', role: 'manager' };
const ADMIN = { employeeId: 'emp-admin', role: 'admin' };

describe('ProductIntegrationService', () => {
  let service: ProductIntegrationService;
  let scoreService: any;
  let requestRepo: any;
  let productRepo: any;
  let employeeRepo: any;
  let auditService: any;

  const managerPinHash = bcrypt.hashSync('1234', 4);
  const cashierPinHash = bcrypt.hashSync('5678', 4);

  const managerEmployee: Partial<EmployeeEntity> = {
    id: 'emp-manager',
    firstName: 'Marie',
    lastName: 'Durand',
    role: 'manager',
    pinHash: managerPinHash,
    isActive: true,
    storeId: STORE,
  };

  const cashierEmployee: Partial<EmployeeEntity> = {
    id: 'emp-cashier',
    firstName: 'Paul',
    lastName: 'Martin',
    role: 'cashier',
    pinHash: cashierPinHash,
    isActive: true,
    storeId: STORE,
  };

  const existingProduct: Partial<ProductEntity> = {
    id: 'prod-1',
    ean: '3760123456789',
    name: 'Coca-Cola 33cl',
    priceMinorUnits: 150,
    stockQuantity: 42,
    status: 'active',
    isActive: true,
    storeId: STORE,
  };

  beforeEach(async () => {
    requestRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((d: any) => ({ ...d, id: 'req-new' })),
      save: jest.fn((e: any) => Promise.resolve({ id: 'req-new', ...e })),
    };
    productRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((d: any) => ({ ...d, id: 'prod-new' })),
      save: jest.fn((e: any) => Promise.resolve({ id: 'prod-new', ...e })),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      })),
    };
    employeeRepo = {
      find: jest.fn().mockResolvedValue([managerEmployee, cashierEmployee]),
      // pinHash is select:false → the service loads employees via QueryBuilder.addSelect
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([managerEmployee, cashierEmployee]),
      })),
    };
    auditService = { log: jest.fn().mockResolvedValue({}) };

    const saleLineRepo = {
      createQueryBuilder: jest.fn(() => ({
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      })),
    };
    const productsService = {
      getOrCreateBrand: jest.fn().mockResolvedValue({ id: 'brand-1' }),
      getOrCreateSupplier: jest.fn().mockResolvedValue({ id: 'sup-1' }),
    };
    scoreService = { logEvent: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductIntegrationService,
        { provide: getRepositoryToken(ProductIntegrationRequestEntity), useValue: requestRepo },
        { provide: getRepositoryToken(ProductEntity), useValue: productRepo },
        { provide: getRepositoryToken(EmployeeEntity), useValue: employeeRepo },
        { provide: getRepositoryToken(SaleLineItemEntity), useValue: saleLineRepo },
        { provide: AuditService, useValue: auditService },
        { provide: ProductsService, useValue: productsService },
        { provide: EmployeeScoreService, useValue: scoreService },
      ],
    }).compile();

    service = module.get(ProductIntegrationService);
  });

  // ── Scan (Dashboard / Inventaire / Caisse) ──────────────────────

  describe('scan', () => {
    it('retourne la fiche produit quand le code-barres existe', async () => {
      productRepo.findOne.mockResolvedValue(existingProduct);

      const res = await service.scan(STORE, CASHIER.employeeId, '3760123456789', 'dashboard');

      expect(res.found).toBe(true);
      if (res.found) {
        expect(res.product.name).toBe('Coca-Cola 33cl');
        expect(res.stockQuantity).toBe(42);
        expect(res.priceMinorUnits).toBe(150);
      }
      // Un scan trouvé n'est pas journalisé comme inconnu
      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('journalise scan_unknown quand le produit est inconnu', async () => {
      const res = await service.scan(STORE, CASHIER.employeeId, '9990000000001', 'pos', 'T-01');

      expect(res.found).toBe(false);
      if (!res.found) {
        expect(res.barcode).toBe('9990000000001');
        expect(res.message).toMatch(/Dashboard ou le module Inventaire/);
      }
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'scan_unknown',
          entityId: '9990000000001',
          details: expect.objectContaining({ source: 'pos', terminalId: 'T-01' }),
        }),
      );
    });
  });

  // ── Demande d'intégration (caisse → alerte seulement) ──────────

  describe('createRequest', () => {
    it('crée une demande en attente depuis la caisse (source, terminal, employé)', async () => {
      const { request, alreadyPending } = await service.createRequest(STORE, CASHIER.employeeId, {
        barcode: '9990000000001',
        source: 'pos',
        terminalId: 'T-01',
        comment: 'Client au comptoir',
      });

      expect(alreadyPending).toBe(false);
      expect(request.status).toBe('pending');
      expect(requestRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          barcode: '9990000000001',
          source: 'pos',
          terminalId: 'T-01',
          requestedBy: CASHIER.employeeId,
          status: 'pending',
        }),
      );
      // La caisse ne crée JAMAIS de produit
      expect(productRepo.save).not.toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'request_created' }),
      );
    });

    it('bloque la demande si le code-barres existe déjà (anti-doublon) + score PRODUCT_DUPLICATE_BLOCKED', async () => {
      productRepo.findOne.mockResolvedValue(existingProduct);

      await expect(
        service.createRequest(STORE, CASHIER.employeeId, {
          barcode: '3760123456789',
          source: 'inventory',
        }),
      ).rejects.toMatchObject({ code: 'PRODUCT_BARCODE_ALREADY_EXISTS' });

      expect(scoreService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'PRODUCT_DUPLICATE_BLOCKED' }),
      );
    });

    it('journalise PRODUCT_CREATION_REQUESTED_FROM_POS pour une demande caisse', async () => {
      await service.createRequest(STORE, CASHIER.employeeId, { barcode: '9990000000002', source: 'pos' });
      expect(scoreService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'PRODUCT_CREATION_REQUESTED_FROM_POS' }),
      );
    });

    it('ne duplique pas une demande déjà en attente pour le même code-barres', async () => {
      const pending = { id: 'req-old', barcode: '999', status: 'pending' };
      requestRepo.findOne.mockResolvedValue(pending);

      const { request, alreadyPending } = await service.createRequest(STORE, CASHIER.employeeId, {
        barcode: '999',
        source: 'pos',
      });

      expect(alreadyPending).toBe(true);
      expect(request.id).toBe('req-old');
      expect(requestRepo.save).not.toHaveBeenCalled();
    });
  });

  // ── Code admin / employé obligatoire (RÈGLE 4) ──────────────────

  describe('verifyOperatorPin', () => {
    it('accepte le PIN d’un manager (peut activer)', async () => {
      const auth = await service.verifyOperatorPin(STORE, CASHIER.employeeId, '1234');
      expect(auth.employeeId).toBe('emp-manager');
      expect(auth.canActivate).toBe(true);
      expect(auth.via).toBe('pin');
    });

    it('refuse un PIN invalide, journalise la tentative', async () => {
      await expect(
        service.verifyOperatorPin(STORE, CASHIER.employeeId, '0000'),
      ).rejects.toMatchObject({ code: 'PRODUCT_CREATE_UNAUTHORIZED' });

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'product_creation_denied',
          details: expect.objectContaining({ reason: 'invalid_pin', result: 'denied' }),
        }),
      );
    });

    it('refuse le PIN d’un employé non autorisé (cashier) — Autorisation insuffisante', async () => {
      await expect(
        service.verifyOperatorPin(STORE, CASHIER.employeeId, '5678'),
      ).rejects.toThrow('Autorisation insuffisante');

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'product_creation_denied',
          details: expect.objectContaining({ reason: 'insufficient_role' }),
        }),
      );
    });
  });

  // ── Création sécurisée de fiche (Dashboard / Inventaire) ────────

  describe('createProduct', () => {
    const baseDto = {
      ean: '9990000000001',
      name: 'Nouveau produit',
      priceMinorUnits: 250,
    };

    it('crée un produit ACTIF avec un PIN manager valide + activate', async () => {
      const { product } = await service.createProduct(STORE, CASHIER, {
        ...baseDto,
        pin: '1234',
        activate: true,
      });

      expect(product.status).toBe('active');
      expect(product.isActive).toBe(true);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'product_created' }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'product_activated' }),
      );
    });

    it('refuse la création avec un PIN invalide (journalisé)', async () => {
      await expect(
        service.createProduct(STORE, CASHIER, { ...baseDto, pin: '0000' }),
      ).rejects.toThrow('Autorisation insuffisante');
      expect(productRepo.save).not.toHaveBeenCalled();
    });

    it('refuse la création à un cashier sans PIN (session insuffisante)', async () => {
      await expect(service.createProduct(STORE, CASHIER, baseDto)).rejects.toMatchObject({
        code: 'PRODUCT_CREATE_UNAUTHORIZED',
      });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'product_creation_denied',
          details: expect.objectContaining({ reason: 'no_authorization' }),
        }),
      );
    });

    it('session manager : création directe, sans PIN', async () => {
      const { product } = await service.createProduct(STORE, MANAGER, {
        ...baseDto,
        activate: true,
      });
      expect(product.status).toBe('active');
    });

    it('sans activate → statut pending_validation (jamais vendable)', async () => {
      const { product } = await service.createProduct(STORE, ADMIN, baseDto);
      expect(product.status).toBe('pending_validation');
      expect(product.isActive).toBe(false);
    });

    it('anti-doublon : refuse deux produits avec le même code-barres', async () => {
      productRepo.findOne.mockResolvedValue(existingProduct);

      await expect(
        service.createProduct(STORE, ADMIN, { ...baseDto, ean: '3760123456789' }),
      ).rejects.toMatchObject({ code: 'PRODUCT_BARCODE_ALREADY_EXISTS' });
    });

    it('convertit la demande en attente liée au code-barres', async () => {
      const pending = { id: 'req-1', barcode: baseDto.ean, status: 'pending', storeId: STORE };
      // 1er findOne (produit doublon) → null ; demande pending trouvée ensuite
      requestRepo.findOne.mockResolvedValue(pending);

      await service.createProduct(STORE, MANAGER, { ...baseDto, activate: true });

      expect(requestRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'req-1', status: 'converted', productId: 'prod-new' }),
      );
    });
  });

  // ── Approbation / rejet des demandes ────────────────────────────

  describe('approve / reject', () => {
    const pendingRequest = {
      id: 'req-1',
      storeId: STORE,
      barcode: '9990000000001',
      status: 'pending',
      proposal: { name: 'Chips 45g', priceMinorUnits: 120 },
    };

    it("approuve une demande → crée la fiche avec le code-barres prérempli", async () => {
      requestRepo.findOne.mockResolvedValue({ ...pendingRequest });

      const { product } = await service.approveRequest(STORE, MANAGER, 'req-1', {});

      expect(product.ean).toBe('9990000000001');
      expect(product.name).toBe('Chips 45g');
      expect(product.status).toBe('active');
    });

    it('refuse une demande incomplète (nom/prix manquants)', async () => {
      requestRepo.findOne.mockResolvedValue({ ...pendingRequest, proposal: null });

      await expect(service.approveRequest(STORE, MANAGER, 'req-1', {})).rejects.toMatchObject({
        code: 'INTEGRATION_REQUEST_INCOMPLETE',
      });
    });

    it('rejette une demande avec raison journalisée', async () => {
      requestRepo.findOne.mockResolvedValue({ ...pendingRequest });

      const res = await service.rejectRequest(STORE, ADMIN.employeeId, 'req-1', 'Produit interdit');

      expect(res.status).toBe('rejected');
      expect(res.rejectionReason).toBe('Produit interdit');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'request_rejected',
          details: expect.objectContaining({ reason: 'Produit interdit' }),
        }),
      );
    });

    it('refuse de décider deux fois la même demande', async () => {
      requestRepo.findOne.mockResolvedValue({ ...pendingRequest, status: 'converted' });

      await expect(service.rejectRequest(STORE, ADMIN.employeeId, 'req-1')).rejects.toBeInstanceOf(
        BusinessError,
      );
    });
  });

  // ── Validation d'un produit en attente ──────────────────────────

  describe('activateProduct', () => {
    it('active un produit pending_validation + audit product_activated', async () => {
      productRepo.findOne.mockResolvedValue({
        ...existingProduct,
        status: 'pending_validation',
        isActive: false,
      });

      const res = await service.activateProduct(STORE, ADMIN, 'prod-1');

      expect(res.status).toBe('active');
      expect(res.isActive).toBe(true);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'product_activated' }),
      );
    });
  });
});
