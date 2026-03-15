// ── decision-engine/audit.logger.ts ─────────────────────────────
// Logs every decision with rule, context snapshot, and actions
// In-memory with optional persistence to DB
// ─────────────────────────────────────────────────────────────────

import { Injectable, Logger } from '@nestjs/common';
import {
  AuditEntry,
  Decision,
  DecisionContext,
  ExecutedAction,
  RulePriority,
} from './decision-engine.types';

const MAX_AUDIT_PER_STORE = 200;

@Injectable()
export class AuditLogger {
  private readonly logger = new Logger('DecisionEngine:Audit');

  /** In-memory audit log: storeId → AuditEntry[] (most recent first) */
  private readonly auditLog = new Map<string, AuditEntry[]>();

  /**
   * Log a decision to the audit trail.
   */
  log(decision: Decision): AuditEntry {
    const entry: AuditEntry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      storeId: decision.storeId,
      ruleId: decision.ruleId,
      ruleName: decision.ruleName,
      rulePriority: this.getRulePriority(decision),
      status: decision.status,
      contextSnapshot: decision.context,
      actions: decision.actions,
      explanation: decision.explanation,
      decidedAt: decision.timestamp,
    };

    // Store in memory
    if (!this.auditLog.has(decision.storeId)) {
      this.auditLog.set(decision.storeId, []);
    }
    const entries = this.auditLog.get(decision.storeId)!;
    entries.unshift(entry);

    // Trim to max size
    if (entries.length > MAX_AUDIT_PER_STORE) {
      entries.splice(MAX_AUDIT_PER_STORE);
    }

    // Log to console for operational visibility
    const actionTypes = decision.actions
      .map((a) => `${a.type}(${a.success ? 'OK' : 'FAIL'})`)
      .join(', ');

    if (decision.status === 'executed') {
      this.logger.log(
        `[AUDIT] Rule "${decision.ruleName}" fired for store ${decision.storeId} → ${actionTypes}`,
      );
    } else if (decision.status === 'skipped_cooldown') {
      this.logger.debug(
        `[AUDIT] Rule "${decision.ruleName}" skipped (cooldown) for store ${decision.storeId}`,
      );
    } else {
      this.logger.warn(
        `[AUDIT] Rule "${decision.ruleName}" FAILED for store ${decision.storeId}: ${actionTypes}`,
      );
    }

    return entry;
  }

  /**
   * Get audit entries for a store.
   */
  getEntries(
    storeId: string,
    options?: {
      limit?: number;
      ruleId?: string;
      status?: string;
      since?: string;
    },
  ): AuditEntry[] {
    let entries = this.auditLog.get(storeId) || [];

    if (options?.ruleId) {
      entries = entries.filter((e) => e.ruleId === options.ruleId);
    }

    if (options?.status) {
      entries = entries.filter((e) => e.status === options.status);
    }

    if (options?.since) {
      const sinceDate = new Date(options.since).getTime();
      entries = entries.filter(
        (e) => new Date(e.decidedAt).getTime() >= sinceDate,
      );
    }

    if (options?.limit) {
      entries = entries.slice(0, options.limit);
    }

    return entries;
  }

  /**
   * Get summary stats for a store.
   */
  getStats(storeId: string): {
    totalDecisions: number;
    executedCount: number;
    skippedCount: number;
    failedCount: number;
    ruleBreakdown: Record<string, number>;
    last24h: number;
  } {
    const entries = this.auditLog.get(storeId) || [];
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    const ruleBreakdown: Record<string, number> = {};
    let executedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    let last24h = 0;

    for (const entry of entries) {
      if (entry.status === 'executed') executedCount++;
      else if (entry.status === 'skipped_cooldown') skippedCount++;
      else failedCount++;

      ruleBreakdown[entry.ruleName] =
        (ruleBreakdown[entry.ruleName] || 0) + 1;

      if (new Date(entry.decidedAt).getTime() >= oneDayAgo) {
        last24h++;
      }
    }

    return {
      totalDecisions: entries.length,
      executedCount,
      skippedCount,
      failedCount,
      ruleBreakdown,
      last24h,
    };
  }

  /**
   * Clear audit log for a store (admin only).
   */
  clear(storeId: string): void {
    this.auditLog.delete(storeId);
    this.logger.warn(`Audit log cleared for store ${storeId}`);
  }

  private getRulePriority(decision: Decision): RulePriority {
    // Default to medium if not available from context
    return 'medium';
  }
}
