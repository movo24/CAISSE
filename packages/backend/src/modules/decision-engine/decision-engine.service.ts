// ── decision-engine/decision-engine.service.ts ─────────────────
// Core decision engine — evaluates rules against context
// Runs every 15 minutes, deterministic, audited
// ─────────────────────────────────────────────────────────────────

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StoreEntity } from '../../database/entities/store.entity';
import { ContextCollector } from './context-collector';
import { ActionsService } from './actions.service';
import { AuditLogger } from './audit.logger';
import { DEFAULT_RULES } from './rules.registry';
import {
  DecisionRule,
  DecisionContext,
  RuleCondition,
  ConditionGroup,
  Decision,
  ExecutedAction,
  RulePriority,
} from './decision-engine.types';

const TRIGGER_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

/** Priority order for conflict resolution */
const PRIORITY_ORDER: Record<RulePriority, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

@Injectable()
export class DecisionEngineService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('DecisionEngine');

  /** Active rules (default + custom per store) */
  private rules: DecisionRule[] = [...DEFAULT_RULES];

  /** Cooldown tracker: `${storeId}:${ruleId}` → last fired timestamp */
  private readonly cooldowns = new Map<string, number>();

  /** Trigger interval handle */
  private triggerInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectRepository(StoreEntity)
    private readonly storeRepo: Repository<StoreEntity>,
    private readonly contextCollector: ContextCollector,
    private readonly actionsService: ActionsService,
    private readonly auditLogger: AuditLogger,
  ) {}

  // ═══════════════════════════════════════════════════════════════
  //  LIFECYCLE
  // ═══════════════════════════════════════════════════════════════

  async onModuleInit() {
    this.logger.log(
      `Decision engine initialized — ${this.rules.filter((r) => r.enabled).length} rules active, trigger every 15min`,
    );

    // Start periodic trigger
    this.triggerInterval = setInterval(
      () => this.triggerAllStores(),
      TRIGGER_INTERVAL_MS,
    );

    // Run initial evaluation after a short delay (let other modules init)
    setTimeout(() => this.triggerAllStores(), 30_000);
  }

  onModuleDestroy() {
    if (this.triggerInterval) {
      clearInterval(this.triggerInterval);
      this.triggerInterval = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  TRIGGER — evaluate all stores
  // ═══════════════════════════════════════════════════════════════

  /**
   * Trigger evaluation for all active stores.
   */
  async triggerAllStores(): Promise<void> {
    try {
      const stores = await this.storeRepo.find({
        where: { isActive: true },
        select: ['id', 'name'],
      });

      this.logger.debug(
        `Trigger: evaluating ${stores.length} store(s) against ${this.rules.filter((r) => r.enabled).length} rule(s)`,
      );

      for (const store of stores) {
        try {
          await this.evaluateStore(store.id);
        } catch (err: any) {
          this.logger.error(
            `Evaluation failed for store ${store.name}: ${err.message}`,
          );
        }
      }
    } catch (err: any) {
      this.logger.error(`Trigger failed: ${err.message}`);
    }
  }

  /**
   * Trigger evaluation for a single store (can be called manually).
   */
  async evaluateStore(storeId: string): Promise<Decision[]> {
    // 1. Collect context
    const context = await this.contextCollector.collect(storeId);

    // 2. Evaluate all enabled rules
    const enabledRules = this.rules
      .filter((r) => r.enabled)
      .sort(
        (a, b) =>
          PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority],
      );

    const decisions: Decision[] = [];

    for (const rule of enabledRules) {
      const decision = await this.evaluateRule(rule, context, storeId);
      if (decision) {
        decisions.push(decision);
        // Log to audit
        this.auditLogger.log(decision);
      }
    }

    if (decisions.filter((d) => d.status === 'executed').length > 0) {
      this.logger.log(
        `Store ${storeId}: ${decisions.filter((d) => d.status === 'executed').length} rule(s) fired, ${decisions.filter((d) => d.status === 'skipped_cooldown').length} skipped (cooldown)`,
      );
    }

    return decisions;
  }

  // ═══════════════════════════════════════════════════════════════
  //  RULE EVALUATION — pure deterministic logic
  // ═══════════════════════════════════════════════════════════════

  /**
   * Evaluate a single rule against the context.
   * Returns a Decision if conditions match (executed or skipped_cooldown).
   * Returns null if conditions don't match.
   */
  private async evaluateRule(
    rule: DecisionRule,
    context: DecisionContext,
    storeId: string,
  ): Promise<Decision | null> {
    // Check conditions
    const conditionsMet = this.evaluateConditions(rule.conditions, context);

    if (!conditionsMet) {
      return null; // Rule doesn't apply
    }

    // Check cooldown
    const cooldownKey = `${storeId}:${rule.id}`;
    const lastFired = this.cooldowns.get(cooldownKey) || 0;
    const cooldownMs = rule.cooldownMinutes * 60 * 1000;

    if (Date.now() - lastFired < cooldownMs) {
      return {
        id: `decision-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
        ruleId: rule.id,
        ruleName: rule.name,
        storeId,
        status: 'skipped_cooldown',
        actions: [],
        context,
        timestamp: new Date().toISOString(),
      };
    }

    // Execute actions
    const executedActions: ExecutedAction[] = [];
    for (const action of rule.actions) {
      const result = await this.actionsService.executeAction(
        action,
        storeId,
        rule.id,
        context,
      );
      executedActions.push(result);
    }

    // Update cooldown
    this.cooldowns.set(cooldownKey, Date.now());

    const allSuccess = executedActions.every((a) => a.success);

    return {
      id: `decision-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      ruleId: rule.id,
      ruleName: rule.name,
      storeId,
      status: allSuccess ? 'executed' : 'failed',
      actions: executedActions,
      context,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Evaluate a condition group (AND/OR logic).
   */
  private evaluateConditions(
    group: ConditionGroup,
    context: DecisionContext,
  ): boolean {
    // ALL conditions must be true (AND)
    if (group.all && group.all.length > 0) {
      const allMet = group.all.every((cond) =>
        this.evaluateCondition(cond, context),
      );
      if (!allMet) return false;
    }

    // ANY condition can be true (OR)
    if (group.any && group.any.length > 0) {
      const anyMet = group.any.some((cond) =>
        this.evaluateCondition(cond, context),
      );
      if (!anyMet) return false;
    }

    return true;
  }

  /**
   * Evaluate a single condition against the context.
   * Uses dot-path to access nested fields.
   */
  private evaluateCondition(
    condition: RuleCondition,
    context: DecisionContext,
  ): boolean {
    const actualValue = this.getNestedValue(context, condition.field);

    switch (condition.operator) {
      case 'eq':
        return actualValue === condition.value;
      case 'neq':
        return actualValue !== condition.value;
      case 'gt':
        return typeof actualValue === 'number' && actualValue > condition.value;
      case 'gte':
        return (
          typeof actualValue === 'number' && actualValue >= condition.value
        );
      case 'lt':
        return typeof actualValue === 'number' && actualValue < condition.value;
      case 'lte':
        return (
          typeof actualValue === 'number' && actualValue <= condition.value
        );
      case 'in':
        return (
          Array.isArray(condition.value) &&
          condition.value.includes(actualValue)
        );
      case 'true':
        return actualValue === true;
      case 'false':
        return actualValue === false;
      default:
        this.logger.warn(`Unknown operator: ${condition.operator}`);
        return false;
    }
  }

  /**
   * Get a nested value from an object using dot-path notation.
   * e.g., "weather.temp" → context.weather.temp
   */
  private getNestedValue(obj: any, path: string): any {
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
      if (current == null) return undefined;
      current = current[part];
    }
    return current;
  }

  // ═══════════════════════════════════════════════════════════════
  //  RULE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════

  /** Get all rules */
  getRules(): DecisionRule[] {
    return [...this.rules];
  }

  /** Get a single rule by ID */
  getRule(ruleId: string): DecisionRule | undefined {
    return this.rules.find((r) => r.id === ruleId);
  }

  /** Add a custom rule */
  addRule(rule: DecisionRule): void {
    // Remove existing rule with same ID if any
    this.rules = this.rules.filter((r) => r.id !== rule.id);
    this.rules.push(rule);
    this.logger.log(`Rule added: ${rule.id} — ${rule.name}`);
  }

  /** Update rule enabled status */
  setRuleEnabled(ruleId: string, enabled: boolean): boolean {
    const rule = this.rules.find((r) => r.id === ruleId);
    if (rule) {
      rule.enabled = enabled;
      this.logger.log(
        `Rule ${ruleId} ${enabled ? 'enabled' : 'disabled'}`,
      );
      return true;
    }
    return false;
  }

  /** Remove a custom rule */
  removeRule(ruleId: string): boolean {
    const before = this.rules.length;
    this.rules = this.rules.filter((r) => r.id !== ruleId);
    return this.rules.length < before;
  }

  /** Reset cooldown for a rule */
  resetCooldown(storeId: string, ruleId: string): void {
    this.cooldowns.delete(`${storeId}:${ruleId}`);
  }

  /** Get current context for a store (debugging) */
  async getContext(storeId: string): Promise<DecisionContext> {
    return this.contextCollector.collect(storeId);
  }

  // ═══════════════════════════════════════════════════════════════
  //  PROMPT HELPER (for assistant injection)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Returns a formatted string for injection into the assistant's prompt.
   * Shows recent decisions so the IA can reference them.
   */
  getContextForPrompt(storeId: string): string {
    const recentDecisions = this.auditLogger.getEntries(storeId, {
      limit: 5,
      status: 'executed',
    });

    if (recentDecisions.length === 0) return '';

    const lines: string[] = [
      `\nDecisions automatiques recentes :`,
    ];

    for (const d of recentDecisions) {
      const actions = d.actions
        .map((a) => a.type)
        .join(', ');
      lines.push(
        `- ${d.ruleName} → ${actions} (${new Date(d.decidedAt).toLocaleTimeString('fr-FR')})`,
      );
    }

    return lines.join('\n');
  }
}
