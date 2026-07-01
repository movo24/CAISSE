import { AirtableOpsMapper, AT_FIELD } from './airtable-ops.mapper';
import { ProductEntity } from '../../database/entities/product.entity';

function product(over: Partial<ProductEntity> = {}): ProductEntity {
  return {
    id: 'p1',
    ean: '3017620422003',
    name: 'Café Bio',
    description: 'desc',
    priceMinorUnits: 500,
    costMinorUnits: 200,
    imageUrl: 'http://img',
    stockQuantity: 10,
    isActive: true,
    storeId: 'store-1',
    updatedAt: new Date('2026-07-01T10:00:00.000Z'),
    ...over,
  } as ProductEntity;
}

describe('AirtableOpsMapper (POS-AIRTABLE-188)', () => {
  const mapper = new AirtableOpsMapper();

  describe('productToAirtable (export POS→Airtable)', () => {
    it('maps all export fields', () => {
      const f = mapper.productToAirtable(product());
      expect(f).toMatchObject({
        [AT_FIELD.POS_ID]: 'p1',
        [AT_FIELD.EAN]: '3017620422003',
        [AT_FIELD.NAME]: 'Café Bio',
        [AT_FIELD.PRICE_CENTS]: 500,
        [AT_FIELD.COST_CENTS]: 200,
        [AT_FIELD.STOCK]: 10,
        [AT_FIELD.IS_ACTIVE]: true,
        [AT_FIELD.STORE_ID]: 'store-1',
        [AT_FIELD.UPDATED_AT]: '2026-07-01T10:00:00.000Z',
      });
    });

    it('defaults null cost and missing description/image', () => {
      const f = mapper.productToAirtable(product({ costMinorUnits: null as any, description: null as any, imageUrl: null as any }));
      expect(f[AT_FIELD.COST_CENTS]).toBeNull();
      expect(f[AT_FIELD.DESCRIPTION]).toBe('');
      expect(f[AT_FIELD.IMAGE_URL]).toBe('');
    });
  });

  describe('airtableToProductOperations (import Airtable→POS proposals)', () => {
    it('classifies copy/SEO fields as LOW risk', () => {
      const ops = mapper.airtableToProductOperations(
        { [AT_FIELD.PUBLIC_NAME]: 'Nom public', [AT_FIELD.SEO_TITLE]: 'T' },
        product(),
      );
      expect(ops.every((o) => o.riskLevel === 'low')).toBe(true);
      expect(ops.map((o) => o.field)).toEqual(expect.arrayContaining([AT_FIELD.PUBLIC_NAME, AT_FIELD.SEO_TITLE]));
    });

    it('classifies validation status + isActive as MEDIUM risk', () => {
      const ops = mapper.airtableToProductOperations(
        { [AT_FIELD.VALIDATION_STATUS]: 'validé', [AT_FIELD.IS_ACTIVE]: false },
        product({ isActive: true }),
      );
      const byField = Object.fromEntries(ops.map((o) => [o.field, o]));
      expect(byField[AT_FIELD.VALIDATION_STATUS].riskLevel).toBe('medium');
      expect(byField['isActive'].riskLevel).toBe('medium');
    });

    it('ALWAYS flags a price change as HIGH risk (never auto-applied)', () => {
      const ops = mapper.airtableToProductOperations({ [AT_FIELD.PRICE_CENTS]: 999 }, product({ priceMinorUnits: 500 }));
      const priceOp = ops.find((o) => o.field === 'priceMinorUnits');
      expect(priceOp).toBeDefined();
      expect(priceOp!.riskLevel).toBe('high');
      expect(priceOp!.proposedValue).toBe(999);
      expect(priceOp!.currentValue).toBe(500);
    });

    it('ALWAYS flags a stock change as HIGH risk', () => {
      const ops = mapper.airtableToProductOperations({ [AT_FIELD.STOCK]: 3 }, product({ stockQuantity: 10 }));
      const stockOp = ops.find((o) => o.field === 'stockQuantity');
      expect(stockOp!.riskLevel).toBe('high');
    });

    it('emits NO operation when price/stock are unchanged', () => {
      const ops = mapper.airtableToProductOperations(
        { [AT_FIELD.PRICE_CENTS]: 500, [AT_FIELD.STOCK]: 10 },
        product({ priceMinorUnits: 500, stockQuantity: 10 }),
      );
      expect(ops.find((o) => o.field === 'priceMinorUnits')).toBeUndefined();
      expect(ops.find((o) => o.field === 'stockQuantity')).toBeUndefined();
    });

    it('emits nothing for an empty import', () => {
      expect(mapper.airtableToProductOperations({}, product())).toEqual([]);
    });
  });
});
