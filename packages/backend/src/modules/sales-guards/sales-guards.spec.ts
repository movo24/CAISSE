import { evaluateSaleGuards } from './sales-guards.engine';
import {
  EvaluateSaleGuardsInput,
  GUARD_CODE,
  GuardCartItem,
  SaleGuardsConfig,
} from './sales-guards.types';

const CONFIG: SaleGuardsConfig = {
  enabled: true,
  lowMarginThresholdPct: 20,
  excessiveDiscountThresholdPct: 20,
  manualPriceDeviationWarnPct: 5,
  manualPriceDeviationBlockPct: 20,
  freeProductDailyThreshold: 10,
  cancellationThreshold: 5,
};

const item = (over: Partial<GuardCartItem> = {}): GuardCartItem => ({
  productId: 'p1',
  productName: 'Cristalline 50cl',
  quantity: 1,
  sellPriceMinorUnits: 180,
  catalogPriceMinorUnits: 180,
  costMinorUnits: 80,
  ...over,
});

const run = (
  items: GuardCartItem[],
  extra: Partial<EvaluateSaleGuardsInput> = {},
) =>
  evaluateSaleGuards({
    storeId: 'store-1',
    sellerId: 'seller-1',
    items,
    config: CONFIG,
    ...extra,
  });

const codes = (rs: ReturnType<typeof run>) => rs.map((r) => r.code);

describe('evaluateSaleGuards', () => {
  // 1
  it('sale above cost with healthy margin → no critical alert', () => {
    const res = run([item({ sellPriceMinorUnits: 180, costMinorUnits: 80 })]);
    expect(res.some((r) => r.severity === 'critical')).toBe(false);
    expect(res).toHaveLength(0);
  });

  // 2
  it('sale below cost → critical + blocking + managerApprovalRequired', () => {
    const res = run([item({ sellPriceMinorUnits: 100, costMinorUnits: 120 })]);
    const a = res.find((r) => r.code === GUARD_CODE.SALE_BELOW_COST);
    expect(a).toBeDefined();
    expect(a!.severity).toBe('critical');
    expect(a!.blocking).toBe(true);
    expect(a!.managerApprovalRequired).toBe(true);
  });

  // 3
  it('product with no cost → non-blocking warning', () => {
    const res = run([item({ costMinorUnits: null })]);
    const a = res.find((r) => r.code === GUARD_CODE.COST_MISSING);
    expect(a).toBeDefined();
    expect(a!.severity).toBe('warning');
    expect(a!.blocking).toBe(false);
    expect(a!.managerApprovalRequired).toBe(false);
  });

  // 4
  it('low margin → non-blocking warning', () => {
    const res = run([item({ sellPriceMinorUnits: 100, costMinorUnits: 90 })]); // 10% margin
    const a = res.find((r) => r.code === GUARD_CODE.LOW_MARGIN);
    expect(a).toBeDefined();
    expect(a!.severity).toBe('warning');
    expect(a!.blocking).toBe(false);
    expect(a!.managerApprovalRequired).toBe(false);
  });

  // 5
  it('excessive discount → managerApprovalRequired', () => {
    const res = run([
      item({ sellPriceMinorUnits: 100, costMinorUnits: 40, quantity: 1, discountMinorUnits: 30 }), // 30%
    ]);
    const a = res.find((r) => r.code === GUARD_CODE.EXCESSIVE_DISCOUNT);
    expect(a).toBeDefined();
    expect(a!.managerApprovalRequired).toBe(true);
  });

  // 6
  it('manual price with small deviation → warning', () => {
    const res = run([
      item({
        catalogPriceMinorUnits: 200,
        sellPriceMinorUnits: 184, // -8%
        costMinorUnits: 80,
        manualPriceOverride: true,
      }),
    ]);
    expect(codes(res)).toContain(GUARD_CODE.MANUAL_PRICE_OVERRIDE);
    expect(codes(res)).not.toContain(GUARD_CODE.MANUAL_PRICE_OVERRIDE_HIGH);
    const a = res.find((r) => r.code === GUARD_CODE.MANUAL_PRICE_OVERRIDE);
    expect(a!.severity).toBe('warning');
    expect(a!.blocking).toBe(false);
  });

  // 7
  it('manual price with large deviation → blocking + manager approval', () => {
    const res = run([
      item({
        catalogPriceMinorUnits: 200,
        sellPriceMinorUnits: 140, // -30%
        costMinorUnits: 80,
        manualPriceOverride: true,
      }),
    ]);
    const a = res.find((r) => r.code === GUARD_CODE.MANUAL_PRICE_OVERRIDE_HIGH);
    expect(a).toBeDefined();
    expect(a!.blocking).toBe(true);
    expect(a!.managerApprovalRequired).toBe(true);
  });

  // 8
  it('free product under threshold → no alert', () => {
    const res = run([item()], { freeProductUsageCount: 10 }); // not > 10
    expect(codes(res)).not.toContain(GUARD_CODE.FREE_PRODUCT_ABUSE);
  });

  // 9
  it('free product over threshold → manager warning', () => {
    const res = run([item()], { freeProductUsageCount: 12 });
    const a = res.find((r) => r.code === GUARD_CODE.FREE_PRODUCT_ABUSE);
    expect(a).toBeDefined();
    expect(a!.severity).toBe('warning');
  });

  // 10
  it('repeated cancellations → backoffice warning', () => {
    const res = run([item()], { cancellationCount: 6 }); // > 5
    const a = res.find((r) => r.code === GUARD_CODE.REPEATED_CANCELLATIONS);
    expect(a).toBeDefined();
    expect(a!.severity).toBe('warning');
    expect(a!.blocking).toBe(false);
  });

  // extra: disabled config → no-op
  it('returns nothing when disabled', () => {
    const res = evaluateSaleGuards({
      storeId: 's',
      sellerId: 'u',
      items: [item({ sellPriceMinorUnits: 10, costMinorUnits: 999 })],
      config: { ...CONFIG, enabled: false },
    });
    expect(res).toHaveLength(0);
  });

  // extra: suspicious recent price change with negative margin
  it('recent price change with negative margin → SUSPICIOUS_PRICE_CHANGE', () => {
    const res = run([
      item({ sellPriceMinorUnits: 50, costMinorUnits: 80, recentPriceChange: true }),
    ]);
    expect(codes(res)).toContain(GUARD_CODE.SUSPICIOUS_PRICE_CHANGE);
    expect(codes(res)).toContain(GUARD_CODE.SALE_BELOW_COST);
  });
});
