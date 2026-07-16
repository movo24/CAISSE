import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ProductsService } from './products.service';
import { CreateProductDto, PRODUCT_LIFECYCLE_STATUSES } from '../../common/dto/products.dto';

/**
 * P-A / M-A — garde-fous « fiche produit ERP » (schéma bd4179b).
 * Vérifie (1) que tous les champs M-A modifiables sont journalisés (product_change_log),
 * (2) que les DTO valident/rejettent correctement les nouveaux champs.
 */

const MA_TRACKED_FIELDS = [
  'longDesignation', 'internalDescription', 'receiptDescription', 'manufacturer', 'lifecycleStatus',
  'weightNetG', 'stockReserved', 'stockMin', 'stockMax', 'stockSafety', 'aisle', 'shelf', 'level', 'tags',
];

async function validateCreate(overrides: Record<string, unknown>) {
  const dto = plainToInstance(CreateProductDto, {
    ean: '3760001000001',
    name: 'Coca 33cl',
    priceMinorUnits: 290,
    ...overrides,
  });
  return validate(dto);
}
const errorProps = (errors: Awaited<ReturnType<typeof validate>>) => errors.map((e) => e.property);

describe('P-A / M-A — journalisation (product_change_log)', () => {
  it('trace tous les champs M-A modifiables dans TRACKED_FIELDS', () => {
    const tracked: string[] = (ProductsService as unknown as { TRACKED_FIELDS: string[] }).TRACKED_FIELDS;
    for (const field of MA_TRACKED_FIELDS) {
      expect(tracked).toContain(field);
    }
  });
});

describe('P-A / M-A — validation DTO', () => {
  it('accepte un jeu complet de champs M-A valides', async () => {
    const errors = await validateCreate({
      longDesignation: 'Canette Coca-Cola 33cl', internalDescription: 'note interne',
      receiptDescription: 'COCA 33CL', manufacturer: 'Coca-Cola Company', lifecycleStatus: 'discontinued',
      weightNetG: 330, stockReserved: 0, stockMin: 10, stockMax: 200, stockSafety: 5,
      aisle: 'A3', shelf: '2', level: 'haut', tags: ['bio', 'promo'],
    });
    expect(errors).toHaveLength(0);
  });

  it('expose exactement les 4 statuts de cycle de vie commercial', () => {
    expect(PRODUCT_LIFECYCLE_STATUSES).toEqual(['active', 'inactive', 'discontinued', 'seasonal']);
  });

  it('rejette un lifecycleStatus hors énumération', async () => {
    expect(errorProps(await validateCreate({ lifecycleStatus: 'sold_out' }))).toContain('lifecycleStatus');
  });

  it('rejette un receiptDescription > 80 caractères', async () => {
    expect(errorProps(await validateCreate({ receiptDescription: 'x'.repeat(81) }))).toContain('receiptDescription');
  });

  it('rejette un weightNetG négatif', async () => {
    expect(errorProps(await validateCreate({ weightNetG: -1 }))).toContain('weightNetG');
  });

  it('rejette plus de 50 étiquettes', async () => {
    expect(errorProps(await validateCreate({ tags: Array.from({ length: 51 }, (_, i) => `t${i}`) }))).toContain('tags');
  });
});
