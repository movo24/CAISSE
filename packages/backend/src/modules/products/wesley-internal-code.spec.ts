import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ProductsService, formatWesleyCode } from './products.service';
import { ProductEntity } from '../../database/entities/product.entity';
import { PriceHistoryEntity } from '../../database/entities/price-history.entity';
import { ProductCategoryEntity } from '../../database/entities/product-category.entity';
import { BrandEntity } from '../../database/entities/brand.entity';
import { SupplierEntity } from '../../database/entities/supplier.entity';
import { StoreProductPriceEntity } from '../../database/entities/store-product-price.entity';
import { ProductComponentEntity } from '../../database/entities/product-component.entity';
import { ProductMediaEntity } from '../../database/entities/product-media.entity';
import { ProductDocumentEntity } from '../../database/entities/product-document.entity';
import { ProductBarcodeEntity } from '../../database/entities/product-barcode.entity';
import { ProductSupplierEntity } from '../../database/entities/product-supplier.entity';
import { ProductChangeLogEntity } from '../../database/entities/product-change-log.entity';
import { ProductLinkEntity } from '../../database/entities/product-link.entity';
import { StoreEntity } from '../../database/entities/store.entity';
import { AuditService } from '../audit/audit.service';
import {
  isWesleyInternalCode,
  isValidProductCode,
  WESLEY_CODE_REGEX,
} from '../../common/validators/gtin.validator';

/**
 * Identifiants internes Wesley — génération SERVEUR uniquement, format
 * `WES-P-############`, distinction `barcode_type` dérivée côté serveur,
 * unicité à l'échelle de toute l'organisation (pas seulement d'un magasin).
 */

describe('formatWesleyCode / validateurs', () => {
  it('formate un numéro de séquence sur 12 chiffres', () => {
    expect(formatWesleyCode(1)).toBe('WES-P-000000000001');
    expect(formatWesleyCode('42')).toBe('WES-P-000000000042');
    expect(formatWesleyCode(999999999999n)).toBe('WES-P-999999999999');
  });

  it('le format généré est accepté par le validateur du DTO', () => {
    expect(isWesleyInternalCode(formatWesleyCode(7))).toBe(true);
    expect(isValidProductCode(formatWesleyCode(7))).toBe(true);
  });

  it.each([
    ['WES-P-1', false],           // pas 12 chiffres
    ['WES-P-00000000000A', false], // lettre
    ['wes-p-000000000001', false], // casse stricte (le code généré est canonique)
    ['WESP-000000000001', false],
    ['WES-P-000000000001 ', true], // trim toléré
  ])('%s → %s', (code, ok) => {
    expect(isWesleyInternalCode(code)).toBe(ok);
  });

  it('ne fabrique JAMAIS un faux EAN : le format Wesley ne ressemble pas à un GTIN', () => {
    expect(WESLEY_CODE_REGEX.test('4006381333931')).toBe(false);
  });
});

describe('ProductsService — codes internes Wesley', () => {
  let service: ProductsService;
  let productRepo: any;

  beforeEach(async () => {
    productRepo = {
      query: jest.fn(),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((d: any) => d),
      save: jest.fn(async (d: any) => ({ id: 'p-new', ...d })),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: getRepositoryToken(ProductEntity), useValue: productRepo },
        { provide: getRepositoryToken(PriceHistoryEntity), useValue: {} },
        { provide: getRepositoryToken(ProductCategoryEntity), useValue: {} },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: getRepositoryToken(BrandEntity), useValue: {} },
        { provide: getRepositoryToken(SupplierEntity), useValue: {} },
        { provide: getRepositoryToken(StoreProductPriceEntity), useValue: {} },
        { provide: getRepositoryToken(ProductComponentEntity), useValue: {} },
        { provide: getRepositoryToken(ProductMediaEntity), useValue: {} },
        { provide: getRepositoryToken(ProductDocumentEntity), useValue: {} },
        { provide: getRepositoryToken(ProductBarcodeEntity), useValue: {} },
        { provide: getRepositoryToken(ProductSupplierEntity), useValue: {} },
        { provide: getRepositoryToken(ProductChangeLogEntity), useValue: {} },
        { provide: getRepositoryToken(ProductLinkEntity), useValue: {} },
        {
          provide: getRepositoryToken(StoreEntity),
          useValue: { findOne: jest.fn().mockResolvedValue({ id: 'store-1' }) },
        },
      ],
    }).compile();
    service = module.get(ProductsService);
  });

  it('generateInternalCode : nextval serveur → WES-P-############ (test 3)', async () => {
    productRepo.query.mockResolvedValueOnce([{ n: '7' }]);
    const out = await service.generateInternalCode();
    expect(out).toEqual({ code: 'WES-P-000000000007', barcodeType: 'INTERNAL_WESLEY' });
    expect(productRepo.query).toHaveBeenCalledWith(
      expect.stringContaining("nextval('wesley_product_code_seq')"),
    );
  });

  it('generateInternalCode est indépendant du magasin (séquence org-wide, test 8)', async () => {
    productRepo.query.mockResolvedValueOnce([{ n: '8' }]).mockResolvedValueOnce([{ n: '9' }]);
    const a = await service.generateInternalCode();
    const b = await service.generateInternalCode();
    // Aucun paramètre magasin : un nouveau magasin obtient la même séquence globale.
    expect(a.code).not.toBe(b.code);
    for (const call of productRepo.query.mock.calls) {
      expect(String(call[0])).not.toMatch(/store/i);
    }
  });

  it('create : barcode_type dérivé serveur — INTERNAL_WESLEY pour un code WES-P', async () => {
    const saved = await service.create(
      { ean: 'WES-P-000000000007', name: 'Vrac maison', storeId: 'store-1', priceMinorUnits: 100 } as any,
      'emp-1',
    );
    expect(saved.barcodeType).toBe('INTERNAL_WESLEY');
  });

  it('create : barcode_type EXTERNAL_GTIN pour un EAN fabricant', async () => {
    const saved = await service.create(
      { ean: '4006381333931', name: 'Stabilo', storeId: 'store-1', priceMinorUnits: 100 } as any,
      'emp-1',
    );
    expect(saved.barcodeType).toBe('EXTERNAL_GTIN');
  });

  it('create : un code Wesley déjà attribué DANS UN AUTRE MAGASIN est refusé (unicité organisation, tests 5+8)', async () => {
    productRepo.findOne.mockImplementation(async ({ where }: any) => {
      // Recherche org-wide (sans storeId) → trouve le produit d'un autre magasin.
      if (where.ean === 'WES-P-000000000001' && !where.storeId) {
        return { id: 'p-autre', name: 'Bonbon vrac', ean: where.ean, storeId: 'store-AUTRE', status: 'active', isActive: true };
      }
      return null;
    });
    await expect(
      service.create(
        { ean: 'WES-P-000000000001', name: 'Doublon', storeId: 'store-1', priceMinorUnits: 100 } as any,
        'emp-1',
      ),
    ).rejects.toMatchObject({ code: 'PRODUCT_BARCODE_ALREADY_EXISTS' });
  });
});
