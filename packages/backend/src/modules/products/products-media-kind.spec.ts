import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ProductsService } from './products.service';
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
import { AuditService } from '../audit/audit.service';

/**
 * P-B / M-C — règle « une seule image principale par produit » (mirroir applicatif
 * de l'index unique partiel `uq_product_media_main`) + repromotion à la suppression.
 */

/** Faux repository en mémoire, suffisant pour les opérations médias. */
function makeMediaRepo() {
  let rows: any[] = [];
  let seq = 0;
  const matches = (r: any, where: any) => Object.entries(where).every(([k, v]) => r[k] === v);
  return {
    _rows: () => rows,
    count: async ({ where }: any) => rows.filter((r) => matches(r, where)).length,
    create: (data: any) => ({ ...data }),
    save: async (row: any) => {
      const r = { id: row.id ?? `m${++seq}`, ...row };
      rows.push(r);
      return r;
    },
    find: async ({ where, order }: any) => {
      let out = rows.filter((r) => matches(r, where));
      if (order?.sortOrder) out = [...out].sort((a, b) => a.sortOrder - b.sortOrder);
      return out;
    },
    findOne: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
    update: async (where: any, patch: any) => {
      rows.forEach((r) => {
        if (matches(r, where)) Object.assign(r, patch);
      });
      return { affected: 1 };
    },
    delete: async (where: any) => {
      rows = rows.filter((r) => !matches(r, where));
      return { affected: 1 };
    },
  };
}

describe('ProductsService — image principale (M-C)', () => {
  let service: ProductsService;
  let mediaRepo: ReturnType<typeof makeMediaRepo>;
  const P = 'p1';
  const S = 's1';
  const mains = () => mediaRepo._rows().filter((r) => r.productId === P && r.kind === 'main');

  beforeEach(async () => {
    mediaRepo = makeMediaRepo();
    const productRepo = { findOne: jest.fn().mockResolvedValue({ id: P, storeId: S }) };
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
        { provide: getRepositoryToken(ProductMediaEntity), useValue: mediaRepo },
        { provide: getRepositoryToken(ProductDocumentEntity), useValue: {} },
        { provide: getRepositoryToken(ProductBarcodeEntity), useValue: {} },
        { provide: getRepositoryToken(ProductSupplierEntity), useValue: {} },
        { provide: getRepositoryToken(ProductChangeLogEntity), useValue: {} },
        { provide: getRepositoryToken(ProductLinkEntity), useValue: {} },
      ],
    }).compile();
    service = module.get(ProductsService);
  });

  it('la première image ajoutée devient principale, les suivantes non', async () => {
    const first = await service.addMedia(P, S, 'http://a');
    const second = await service.addMedia(P, S, 'http://b');
    expect(first.kind).toBe('main');
    expect(second.kind).toBe('other');
    expect(mains()).toHaveLength(1);
  });

  it('ajouter une image explicitement `main` retire la principale précédente', async () => {
    await service.addMedia(P, S, 'http://a'); // main
    await service.addMedia(P, S, 'http://b', 'main');
    expect(mains()).toHaveLength(1);
    expect(mains()[0].url).toBe('http://b');
  });

  it('setMediaKind(main) bascule la principale sans jamais en laisser deux', async () => {
    await service.addMedia(P, S, 'http://a'); // main
    const b = await service.addMedia(P, S, 'http://b'); // other
    await service.setMediaKind(P, S, b.id, 'main');
    expect(mains()).toHaveLength(1);
    expect(mains()[0].id).toBe(b.id);
  });

  it('rejette un type d\'image invalide', async () => {
    const a = await service.addMedia(P, S, 'http://a');
    await expect(service.setMediaKind(P, S, a.id, 'cover' as any)).rejects.toThrow();
  });

  it('supprimer la principale repromeut la première image restante', async () => {
    const a = await service.addMedia(P, S, 'http://a'); // main
    await service.addMedia(P, S, 'http://b'); // other
    await service.removeMedia(P, S, a.id);
    expect(mains()).toHaveLength(1);
    expect(mains()[0].url).toBe('http://b');
  });
});
