import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PromotionsService, CartItem } from './promotions.service';
import { PromoRuleEntity } from '../../database/entities/promo-rule.entity';

describe('PromotionsService', () => {
  let service: PromotionsService;
  let promoRepo: any;

  const now = new Date();

  const mockPercentagePromo: Partial<PromoRuleEntity> = {
    id: 'promo-1',
    storeId: 'store-1',
    name: '-10% tout',
    type: 'percentage',
    discountPercent: 10,
    isActive: true,
    startDate: new Date(now.getTime() - 86400000),
    applicableProductIds: [],
    applicableCategoryIds: [],
  };

  const mockFixedPromo: Partial<PromoRuleEntity> = {
    id: 'promo-2',
    storeId: 'store-1',
    name: '-2EUR sur prod-A',
    type: 'fixed_amount',
    discountFixedMinorUnits: 200,
    isActive: true,
    startDate: new Date(now.getTime() - 86400000),
    applicableProductIds: ['prod-A'],
    applicableCategoryIds: [],
  };

  const mockBuyXPromo: Partial<PromoRuleEntity> = {
    id: 'promo-3',
    storeId: 'store-1',
    name: '2+1 gratuit',
    type: 'buy_x_get_discount',
    buyQuantity: 2,
    discountPercent: 100,
    isActive: true,
    startDate: new Date(now.getTime() - 86400000),
    applicableProductIds: ['prod-B'],
    applicableCategoryIds: [],
  };

  const mockFirstPurchasePromo: Partial<PromoRuleEntity> = {
    id: 'promo-4',
    storeId: 'store-1',
    name: '-5% premiere visite',
    type: 'first_purchase',
    isActive: true,
    startDate: new Date(now.getTime() - 86400000),
    applicableProductIds: [],
    applicableCategoryIds: [],
  };

  beforeEach(async () => {
    promoRepo = {
      create: jest.fn().mockImplementation((data) => ({ ...data, id: 'new-promo' })),
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
      find: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PromotionsService,
        {
          provide: getRepositoryToken(PromoRuleEntity),
          useValue: promoRepo,
        },
      ],
    }).compile();

    service = module.get<PromotionsService>(PromotionsService);
  });

  // ─────────────────────────────────────────────────────────────
  // Tenant isolation
  // ─────────────────────────────────────────────────────────────

  describe('findOneForStore (tenant isolation)', () => {
    it('should return promo for correct store', async () => {
      promoRepo.findOne.mockResolvedValue(mockPercentagePromo);

      const result = await service.findOneForStore('promo-1', 'store-1');
      expect(result.id).toBe('promo-1');
    });

    it('should throw ForbiddenException for wrong store', async () => {
      promoRepo.findOne.mockResolvedValue(null);

      await expect(
        service.findOneForStore('promo-1', 'other-store'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('update (tenant isolation)', () => {
    it('should update promo for correct store', async () => {
      promoRepo.findOne.mockResolvedValue(mockPercentagePromo);

      const result = await service.update(
        'promo-1',
        { discountPercent: 15 },
        'store-1',
      );
      expect(promoRepo.update).toHaveBeenCalledWith('promo-1', { discountPercent: 15 });
    });

    it('should throw for wrong store', async () => {
      promoRepo.findOne.mockResolvedValue(null);

      await expect(
        service.update('promo-1', { discountPercent: 15 }, 'other-store'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // applyPromos — business logic
  // ─────────────────────────────────────────────────────────────

  describe('applyPromos', () => {
    const cartItems: CartItem[] = [
      { productId: 'prod-A', quantity: 2, unitPriceMinorUnits: 1000 },
      { productId: 'prod-B', quantity: 3, unitPriceMinorUnits: 500 },
    ];

    it('should apply percentage discount to all products', async () => {
      promoRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockPercentagePromo]),
      });

      const results = await service.applyPromos('store-1', cartItems);

      // 10% on 2x1000 = 200, 10% on 3x500 = 150
      expect(results).toHaveLength(2);
      expect(results[0].discountMinorUnits).toBe(200);
      expect(results[1].discountMinorUnits).toBe(150);
    });

    it('should apply fixed amount only to applicable product', async () => {
      promoRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockFixedPromo]),
      });

      const results = await service.applyPromos('store-1', cartItems);

      expect(results).toHaveLength(1);
      expect(results[0].productId).toBe('prod-A');
      expect(results[0].discountMinorUnits).toBe(200);
    });

    it('should apply buy_x_get_discount correctly', async () => {
      promoRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockBuyXPromo]),
      });

      const results = await service.applyPromos('store-1', cartItems);

      // 3 items of prod-B, buy 2 get 1: floor(3/3)=1 discounted item at 100% = 500
      expect(results).toHaveLength(1);
      expect(results[0].productId).toBe('prod-B');
      expect(results[0].discountMinorUnits).toBe(500);
    });

    it('should skip first_purchase promo when not first purchase', async () => {
      promoRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockFirstPurchasePromo]),
      });

      const results = await service.applyPromos('store-1', cartItems, false);
      expect(results).toHaveLength(0);
    });

    it('should apply first_purchase promo when is first purchase', async () => {
      promoRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockFirstPurchasePromo]),
      });

      const results = await service.applyPromos('store-1', cartItems, true);
      // 5% on all items
      expect(results).toHaveLength(2);
      expect(results[0].discountMinorUnits).toBe(100); // 5% of 2000
      expect(results[1].discountMinorUnits).toBe(75);  // 5% of 1500
    });

    it('should return no discounts when no active promos', async () => {
      promoRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      });

      const results = await service.applyPromos('store-1', cartItems);
      expect(results).toHaveLength(0);
    });

    // POS-073 anti-cumul: two promos on the same product → only the largest is kept.
    it('should NOT stack two promos on the same product (keeps the largest)', async () => {
      const big: Partial<PromoRuleEntity> = {
        id: 'promo-big',
        storeId: 'store-1',
        name: '-50% prod-A',
        type: 'percentage',
        discountPercent: 50, // 50% of 2x1000 = 1000
        isActive: true,
        startDate: new Date(now.getTime() - 86400000),
        applicableProductIds: ['prod-A'],
        applicableCategoryIds: [],
      };
      const small: Partial<PromoRuleEntity> = {
        id: 'promo-small',
        storeId: 'store-1',
        name: '-2EUR prod-A',
        type: 'fixed_amount',
        discountFixedMinorUnits: 200,
        isActive: true,
        startDate: new Date(now.getTime() - 86400000),
        applicableProductIds: ['prod-A'],
        applicableCategoryIds: [],
      };
      promoRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([big, small]),
      });

      const results = await service.applyPromos('store-1', cartItems);
      const prodA = results.filter((r) => r.productId === 'prod-A');
      expect(prodA).toHaveLength(1); // not stacked
      expect(prodA[0].discountMinorUnits).toBe(1000); // largest kept
    });
  });

  // POS-071 — scope by product / category, and out-of-scope exclusion.
  describe('applyPromos — scope (POS-071)', () => {
    const catPromo: Partial<PromoRuleEntity> = {
      id: 'promo-cat',
      storeId: 'store-1',
      name: '-10% cat-X',
      type: 'percentage',
      discountPercent: 10,
      isActive: true,
      startDate: new Date(now.getTime() - 86400000),
      applicableProductIds: [],
      applicableCategoryIds: ['cat-X'],
    };

    it('applies a category-scoped promo only to items in that category', async () => {
      promoRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([catPromo]),
      });
      const cart: CartItem[] = [
        { productId: 'p1', categoryId: 'cat-X', quantity: 1, unitPriceMinorUnits: 1000 },
        { productId: 'p2', categoryId: 'cat-Y', quantity: 1, unitPriceMinorUnits: 1000 },
      ];
      const results = await service.applyPromos('store-1', cart);
      expect(results).toHaveLength(1);
      expect(results[0].productId).toBe('p1');
      expect(results[0].discountMinorUnits).toBe(100);
    });

    it('does NOT apply a product-scoped promo to a different product (out of scope)', async () => {
      promoRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockFixedPromo]), // scoped to prod-A
      });
      const cart: CartItem[] = [
        { productId: 'prod-C', quantity: 1, unitPriceMinorUnits: 1000 },
      ];
      const results = await service.applyPromos('store-1', cart);
      expect(results).toHaveLength(0);
    });
  });

  // POS-073 — getActivePromos must exclude promos that reached their usage cap.
  describe('getActivePromos usage cap (POS-073)', () => {
    it('adds the usage_limit exclusion clause to the query', async () => {
      const andWhere = jest.fn().mockReturnThis();
      promoRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere,
        getMany: jest.fn().mockResolvedValue([]),
      });
      await service.getActivePromos('store-1');
      const clauses = andWhere.mock.calls.map((c) => String(c[0]));
      expect(clauses.some((c) => c.includes('usage_limit') && c.includes('usage_count'))).toBe(true);
    });
  });
});
