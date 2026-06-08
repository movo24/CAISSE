/**
 * Sales-guards types & guard codes.
 *
 * The engine that consumes these is PURE and READ-ONLY: it inspects a cart and
 * returns a list of anomalies. It never mutates sales, tickets, or payments.
 */

export type GuardSeverity = 'info' | 'warning' | 'critical';

export type AnomalyStatus = 'detected' | 'approved' | 'ignored' | 'resolved';

/** Stable codes — used by the UI, persisted in SaleAnomalyLog, and tested. */
export const GUARD_CODE = {
  SALE_BELOW_COST: 'SALE_BELOW_COST',
  LOW_MARGIN: 'LOW_MARGIN',
  COST_MISSING: 'COST_MISSING',
  MANUAL_PRICE_OVERRIDE: 'MANUAL_PRICE_OVERRIDE',
  MANUAL_PRICE_OVERRIDE_HIGH: 'MANUAL_PRICE_OVERRIDE_HIGH',
  EXCESSIVE_DISCOUNT: 'EXCESSIVE_DISCOUNT',
  FREE_PRODUCT_ABUSE: 'FREE_PRODUCT_ABUSE',
  REPEATED_CANCELLATIONS: 'REPEATED_CANCELLATIONS',
  SUSPICIOUS_PRICE_CHANGE: 'SUSPICIOUS_PRICE_CHANGE',
} as const;

export type GuardCode = (typeof GUARD_CODE)[keyof typeof GUARD_CODE];

export interface SaleGuardResult {
  code: GuardCode;
  severity: GuardSeverity;
  blocking: boolean;
  managerApprovalRequired: boolean;
  message: string;
  productId?: string;
  metadata?: Record<string, unknown>;
}

export interface GuardCartItem {
  productId: string;
  productName?: string;
  quantity: number;
  /** Price actually charged per unit (after manual override, before line discount). */
  sellPriceMinorUnits: number;
  /** Catalogue reference price per unit. */
  catalogPriceMinorUnits: number;
  /** Cost per unit; null when not set on the product. */
  costMinorUnits: number | null;
  /** Absolute discount applied to this line (minor units). */
  discountMinorUnits?: number;
  /** True when the cashier overrode the catalogue price for this line. */
  manualPriceOverride?: boolean;
  /** True when this line is an open/free product ("produit libre"). */
  isFreeProduct?: boolean;
  /** True when this product's price was changed recently (caller-supplied). */
  recentPriceChange?: boolean;
}

export interface SaleGuardsConfig {
  enabled: boolean;
  /** Gross-margin % below which a warning is raised (e.g. 20). */
  lowMarginThresholdPct: number;
  /** Line discount % above which manager approval is required (e.g. 20). */
  excessiveDiscountThresholdPct: number;
  /** Manual-price deviation % above which a warning is raised (e.g. 5). */
  manualPriceDeviationWarnPct: number;
  /** Manual-price deviation % above which it blocks + needs manager (e.g. 20). */
  manualPriceDeviationBlockPct: number;
  /** Free-product daily count above which an alert is raised (e.g. 10). */
  freeProductDailyThreshold: number;
  /** Cancellation count above which a backoffice alert is raised (e.g. 5). */
  cancellationThreshold: number;
}

/**
 * Raw item as received from the POS client. The client knows the charged price
 * and discount but NOT the cost/catalogue (those stay server-side). The service
 * enriches these into a full GuardCartItem before running the pure engine.
 */
export interface RawGuardCartItem {
  productId: string;
  ean?: string;
  productName?: string;
  quantity: number;
  sellPriceMinorUnits?: number;
  catalogPriceMinorUnits?: number;
  costMinorUnits?: number | null;
  discountMinorUnits?: number;
  manualPriceOverride?: boolean;
  isFreeProduct?: boolean;
  recentPriceChange?: boolean;
}

export interface EvaluateSaleGuardsInput {
  storeId: string;
  sellerId: string;
  items: GuardCartItem[];
  /** Free-product usage count for this seller/store today (caller-supplied). */
  freeProductUsageCount?: number;
  /** Recent cancellation count for this seller (caller-supplied). */
  cancellationCount?: number;
  config: SaleGuardsConfig;
}
