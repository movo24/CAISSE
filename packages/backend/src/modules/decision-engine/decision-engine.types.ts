// ── decision-engine/decision-engine.types.ts ────────────────────
// Types for the deterministic decision engine
// Rules → Context → Decision → Action → Audit
// ─────────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════
//  CONTEXT — collected from all data sources
// ═══════════════════════════════════════════════════════════════

export type WeatherConditionTag =
  | 'rain'
  | 'heavy_rain'
  | 'hot'
  | 'cold'
  | 'wind'
  | 'clear'
  | 'cloudy';

export type TrafficLevelTag = 'low' | 'medium' | 'high';

export type TransportStatusTag = 'normal' | 'perturbe' | 'interrompu';

export interface DecisionContext {
  storeId: string;
  timestamp: string;

  // ── Weather ──
  weather: {
    available: boolean;
    temp?: number;
    feelsLike?: number;
    condition?: WeatherConditionTag;
    isRaining?: boolean;
    rainIntensity?: number;
    windSpeed?: number;
  };

  // ── Transport ──
  transport: {
    available: boolean;
    status?: TransportStatusTag;
    activeDisruptions?: number;
    hasStrike?: boolean;
  };

  // ── Footfall ──
  footfall: {
    available: boolean;
    score?: number;
    level?: TrafficLevelTag;
    totalNearbyPlaces?: number;
  };

  // ── Sales (recent window) ──
  sales: {
    available: boolean;
    /** Sales in the last hour */
    lastHourCount?: number;
    lastHourRevenue?: number;
    /** Sales today */
    todayCount?: number;
    todayRevenue?: number;
    /** Top selling product IDs in last hour */
    topSellingProductIds?: string[];
    /** Slow-moving product IDs (no sales in last 3 hours) */
    slowMovingProductIds?: string[];
  };

  // ── Time ──
  time: {
    hour: number;           // 0-23
    dayOfWeek: number;      // 0=Sun, 6=Sat
    isWeekend: boolean;
    isPeakHour: boolean;    // 11-14, 17-20
  };

  // ── Stock ──
  stock: {
    available: boolean;
    alertCount?: number;
    criticalCount?: number;
    outOfStockCount?: number;
  };

  // ── Employee activity (fraud/theft detection) ──
  employees: {
    available: boolean;
    /** Per-employee activity in the current shift */
    activity?: EmployeeActivity[];
    /** Store-level aggregates */
    totalVoidsToday?: number;
    totalDiscountsToday?: number;
    /** Average discount rate across all sales today (%) */
    avgDiscountRateToday?: number;
    /** Number of employees currently clocked in */
    clockedInCount?: number;
    /** Employees with pointage anomalies */
    anomalyEmployeeIds?: string[];
  };
}

/** Per-employee activity metrics for the current shift */
export interface EmployeeActivity {
  employeeId: string;
  employeeName: string;
  role: string;
  /** Number of completed sales today */
  salesCount: number;
  /** Total revenue today (minor units) */
  revenueTotal: number;
  /** Number of voided sales today */
  voidCount: number;
  /** Void rate: voidCount / (salesCount + voidCount) */
  voidRate: number;
  /** Total discounts given today (minor units) */
  discountTotal: number;
  /** Average discount % per sale */
  avgDiscountPercent: number;
  /** Number of no-sale register opens (if tracked) */
  noSaleCount: number;
  /** Average sale amount (minor units) */
  avgSaleAmount: number;
  /** Time since last sale (minutes) — long idle = suspicious */
  minutesSinceLastSale: number | null;
  /** Is currently clocked in */
  isClockedIn: boolean;
  /** Selling outside scheduled hours */
  isSellingOffClock: boolean;
}

// ═══════════════════════════════════════════════════════════════
//  RULES — deterministic conditions
// ═══════════════════════════════════════════════════════════════

export type RuleOperator =
  | 'eq'       // ==
  | 'neq'      // !=
  | 'gt'       // >
  | 'gte'      // >=
  | 'lt'       // <
  | 'lte'      // <=
  | 'in'       // value in array
  | 'true'     // boolean true
  | 'false';   // boolean false

/** A single condition in a rule */
export interface RuleCondition {
  /** Dot-path into DecisionContext, e.g. "weather.condition", "footfall.score" */
  field: string;
  operator: RuleOperator;
  value: any;
}

/** Logical grouping of conditions */
export type ConditionGroup = {
  /** ALL conditions must be true (AND) */
  all?: RuleCondition[];
  /** ANY condition can be true (OR) */
  any?: RuleCondition[];
};

export type ActionType = 'create_promo' | 'alert_manager' | 'suggest_price';

/** What to do when a rule fires */
export interface RuleAction {
  type: ActionType;
  params: Record<string, any>;
}

/** Priority levels for rules */
export type RulePriority = 'low' | 'medium' | 'high' | 'critical';

/** A complete decision rule */
export interface DecisionRule {
  id: string;
  name: string;
  description: string;
  /** When true, this rule is evaluated */
  enabled: boolean;
  /** Higher priority rules take precedence on conflicts */
  priority: RulePriority;
  /** Conditions that must be met */
  conditions: ConditionGroup;
  /** Actions to execute when conditions are met */
  actions: RuleAction[];
  /** Cooldown: minimum minutes between re-firings of same rule per store */
  cooldownMinutes: number;
  /** Optional: only apply to specific categories */
  targetCategoryIds?: string[];
  /** Optional: only apply to specific products */
  targetProductIds?: string[];
}

// ═══════════════════════════════════════════════════════════════
//  DECISIONS — what the engine decided
// ═══════════════════════════════════════════════════════════════

export type DecisionStatus = 'executed' | 'skipped_cooldown' | 'failed';

export interface Decision {
  id: string;
  ruleId: string;
  ruleName: string;
  storeId: string;
  status: DecisionStatus;
  actions: ExecutedAction[];
  context: DecisionContext;
  /** AI-generated explanation (filled after execution) */
  explanation?: string;
  timestamp: string;
}

export interface ExecutedAction {
  type: ActionType;
  params: Record<string, any>;
  success: boolean;
  result?: any;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════
//  AUDIT — every decision logged
// ═══════════════════════════════════════════════════════════════

export interface AuditEntry {
  id: string;
  storeId: string;
  ruleId: string;
  ruleName: string;
  rulePriority: RulePriority;
  status: DecisionStatus;
  /** Snapshot of the context at decision time */
  contextSnapshot: DecisionContext;
  /** Actions taken */
  actions: ExecutedAction[];
  /** AI explanation */
  explanation?: string;
  /** When the decision was made */
  decidedAt: string;
}

// ═══════════════════════════════════════════════════════════════
//  ACTION PARAMS — typed params for each action type
// ═══════════════════════════════════════════════════════════════

export interface CreatePromoParams {
  name: string;
  type: 'percentage' | 'fixed_amount';
  discountPercent?: number;
  discountFixedMinorUnits?: number;
  /** Duration in hours */
  durationHours: number;
  /** Target products by category or explicit IDs */
  targetCategoryIds?: string[];
  targetProductIds?: string[];
}

export interface AlertManagerParams {
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  /** Optional: suggest an action */
  suggestedAction?: string;
}

export interface SuggestPriceParams {
  /** Product selection strategy */
  strategy: 'slow_moving' | 'high_demand' | 'category';
  /** Price adjustment percentage (negative = discount, positive = markup) */
  adjustmentPercent: number;
  /** Reason for the suggestion */
  reason: string;
  targetCategoryIds?: string[];
  targetProductIds?: string[];
}
