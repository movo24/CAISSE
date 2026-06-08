import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AirtableOpsSyncService } from '../airtable-ops.sync.service';
import { AirtableOpsConfig } from '../airtable-ops.config';
import { AirtableOpsMapper } from '../airtable-ops.mapper';
import { ProductEntity } from '../../../database/entities/product.entity';
import { AirtableLinkedRecordEntity } from '../../../database/entities/airtable-linked-record.entity';
import { AirtableSyncLogEntity } from '../../../database/entities/airtable-sync-log.entity';
import { AirtableOperationEntity } from '../../../database/entities/airtable-operation.entity';

const makeProduct = (overrides: Partial<ProductEntity> = {}): ProductEntity =>
  ({
    id: 'prod-1',
    ean: '3760168390157',
    name: 'Café Arabica 250g',
    description: 'Un café de qualité',
    categoryId: null,
    unitType: 'unit',
    priceMinorUnits: 499,
    oldPriceMinorUnits: null,
    currencyCode: 'EUR',
    costMinorUnits: 210,
    taxRate: 5.5,
    imageUrl: null,
    stockQuantity: 42,
    stockAlertThreshold: 10,
    stockCriticalThreshold: 5,
    isActive: true,
    storeId: 'store-1',
    barcodeSource: 'imported',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ProductEntity);

describe('AirtableOpsMapper', () => {
  let mapper: AirtableOpsMapper;

  beforeEach(() => {
    mapper = new AirtableOpsMapper();
  });

  describe('productToAirtable', () => {
    it('maps all required fields', () => {
      const product = makeProduct();
      const fields = mapper.productToAirtable(product);

      expect(fields['POS_ID']).toBe('prod-1');
      expect(fields['Code EAN']).toBe('3760168390157');
      expect(fields['Nom']).toBe('Café Arabica 250g');
      expect(fields['Prix (centimes)']).toBe(499);
      expect(fields['Stock']).toBe(42);
      expect(fields['Actif']).toBe(true);
      expect(fields['Magasin ID']).toBe('store-1');
    });

    it('maps null imageUrl to empty string', () => {
      const product = makeProduct({ imageUrl: null });
      const fields = mapper.productToAirtable(product);
      expect(fields['Image URL']).toBe('');
    });
  });

  describe('airtableToProductOperations', () => {
    it('creates a low-risk op for publicName proposal', () => {
      const product = makeProduct();
      const ops = mapper.airtableToProductOperations(
        { 'Nom public': 'Arabica Premium' } as any,
        product,
      );
      expect(ops).toHaveLength(1);
      expect(ops[0].field).toBe('Nom public');
      expect(ops[0].riskLevel).toBe('low');
      expect(ops[0].proposedValue).toBe('Arabica Premium');
    });

    it('creates a high-risk op for price change', () => {
      const product = makeProduct({ priceMinorUnits: 499 });
      const ops = mapper.airtableToProductOperations(
        { 'Prix (centimes)': 549 } as any,
        product,
      );
      expect(ops).toHaveLength(1);
      expect(ops[0].field).toBe('priceMinorUnits');
      expect(ops[0].riskLevel).toBe('high');
      expect(ops[0].currentValue).toBe(499);
      expect(ops[0].proposedValue).toBe(549);
    });

    it('creates a medium-risk op for isActive change', () => {
      const product = makeProduct({ isActive: true });
      const ops = mapper.airtableToProductOperations(
        { 'Actif': false } as any,
        product,
      );
      expect(ops).toHaveLength(1);
      expect(ops[0].field).toBe('isActive');
      expect(ops[0].riskLevel).toBe('medium');
    });

    it('skips unchanged price field', () => {
      const product = makeProduct({ priceMinorUnits: 499 });
      const ops = mapper.airtableToProductOperations(
        { 'Prix (centimes)': 499 } as any,
        product,
      );
      expect(ops).toHaveLength(0);
    });

    it('returns empty array when no proposal fields are present', () => {
      const product = makeProduct();
      const ops = mapper.airtableToProductOperations({} as any, product);
      expect(ops).toHaveLength(0);
    });
  });
});

describe('AirtableOpsSyncService — no-op when disabled', () => {
  let syncService: AirtableOpsSyncService;
  const mockRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AirtableOpsSyncService,
        {
          provide: AirtableOpsConfig,
          useValue: { enabled: false, minDelayMs: 250 },
        },
        { provide: AirtableOpsMapper, useValue: new AirtableOpsMapper() },
        { provide: getRepositoryToken(ProductEntity), useValue: mockRepo },
        { provide: getRepositoryToken(AirtableLinkedRecordEntity), useValue: mockRepo },
        { provide: getRepositoryToken(AirtableSyncLogEntity), useValue: mockRepo },
        { provide: getRepositoryToken(AirtableOperationEntity), useValue: mockRepo },
      ],
    }).compile();

    syncService = module.get(AirtableOpsSyncService);
    jest.clearAllMocks();
  });

  it('exportProducts returns immediately without DB access when disabled', async () => {
    await syncService.exportProducts(undefined, false, 'MANUAL');
    expect(mockRepo.find).not.toHaveBeenCalled();
  });

  it('importProductSuggestions returns immediately without DB access when disabled', async () => {
    await syncService.importProductSuggestions(undefined, 'MANUAL');
    expect(mockRepo.find).not.toHaveBeenCalled();
  });
});
