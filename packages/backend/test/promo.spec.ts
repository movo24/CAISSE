/**
 * Tests for Promotion Engine
 *
 * Validates the core promo logic without database dependencies.
 * We test the calculation logic directly.
 */

describe('Promotion Engine', () => {
  // Simulate the promo logic from PromotionsService.applyPromos
  function applyBuyXGetDiscount(
    quantity: number,
    unitPriceMinorUnits: number,
    buyQuantity: number,
    discountPercent: number,
  ): number {
    const groupSize = buyQuantity + 1;
    const discountedItems = Math.floor(quantity / groupSize);
    if (discountedItems <= 0) return 0;
    const discountPerItem = Math.round(
      unitPriceMinorUnits * (discountPercent / 100),
    );
    return discountPerItem * discountedItems;
  }

  function applyPercentage(
    quantity: number,
    unitPriceMinorUnits: number,
    discountPercent: number,
  ): number {
    const lineTotal = unitPriceMinorUnits * quantity;
    return Math.round(lineTotal * (discountPercent / 100));
  }

  function applyFirstPurchase(
    quantity: number,
    unitPriceMinorUnits: number,
  ): number {
    const lineTotal = unitPriceMinorUnits * quantity;
    return Math.round(lineTotal * 0.05); // 5%
  }

  describe('Buy X Get Discount', () => {
    it('should give 50% off 3rd item when buying 3 socks', () => {
      // Buy 2 get 3rd at -50%, socks at 8.90 EUR (890 centimes)
      const discount = applyBuyXGetDiscount(3, 890, 2, 50);
      expect(discount).toBe(445); // 50% of 890 = 445
    });

    it('should give no discount when buying 2 socks (need 3)', () => {
      const discount = applyBuyXGetDiscount(2, 890, 2, 50);
      expect(discount).toBe(0);
    });

    it('should give discount on 2 items when buying 6 socks', () => {
      const discount = applyBuyXGetDiscount(6, 890, 2, 50);
      expect(discount).toBe(890); // 2 * 445
    });

    it('should handle buy 1 get 2nd at -30%', () => {
      const discount = applyBuyXGetDiscount(2, 2990, 1, 30);
      expect(discount).toBe(897); // 30% of 2990
    });

    it('should handle quantity of 1 (no discount)', () => {
      const discount = applyBuyXGetDiscount(1, 890, 2, 50);
      expect(discount).toBe(0);
    });
  });

  describe('Percentage Discount', () => {
    it('should apply 10% off a 29.90 EUR item', () => {
      const discount = applyPercentage(1, 2990, 10);
      expect(discount).toBe(299);
    });

    it('should apply 10% off 3 items', () => {
      const discount = applyPercentage(3, 2990, 10);
      expect(discount).toBe(897); // 10% of 8970
    });
  });

  describe('First Purchase -5%', () => {
    it('should apply 5% off a 59.90 EUR item', () => {
      const discount = applyFirstPurchase(1, 5990);
      expect(discount).toBe(300); // Math.round(5990 * 0.05) = 299.5 -> 300
    });

    it('should apply 5% off multiple items', () => {
      const discount = applyFirstPurchase(2, 2990);
      expect(discount).toBe(299); // Math.round(5980 * 0.05) = 299
    });
  });
});
