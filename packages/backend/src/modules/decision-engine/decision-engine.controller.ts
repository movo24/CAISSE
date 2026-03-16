// ── decision-engine/decision-engine.controller.ts ───────────────
// REST endpoints for the decision engine
// ─────────────────────────────────────────────────────────────────

import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Query,
  Body,
  Logger,
  HttpException,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { DecisionEngineService } from './decision-engine.service';
import { ActionsService } from './actions.service';
import { AuditLogger } from './audit.logger';

@Controller('decision-engine')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'manager')
export class DecisionEngineController {
  private readonly logger = new Logger('DecisionEngine:Controller');

  constructor(
    private readonly engine: DecisionEngineService,
    private readonly actions: ActionsService,
    private readonly audit: AuditLogger,
  ) {}

  // ═══════════════════════════════════════════════════════════════
  //  STATUS & RULES
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET /api/decision-engine/status
   * Health check + stats
   */
  @Get('status')
  @SkipThrottle()
  getStatus() {
    const rules = this.engine.getRules();
    return {
      module: 'decision-engine',
      totalRules: rules.length,
      enabledRules: rules.filter((r) => r.enabled).length,
      ruleIds: rules.map((r) => ({
        id: r.id,
        name: r.name,
        enabled: r.enabled,
        priority: r.priority,
      })),
      triggerInterval: '15 minutes',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * GET /api/decision-engine/rules
   * List all rules with their configuration
   */
  @Get('rules')
  getRules() {
    return {
      rules: this.engine.getRules(),
      total: this.engine.getRules().length,
    };
  }

  /**
   * PUT /api/decision-engine/rules/:ruleId/toggle
   * Enable or disable a rule
   */
  @Put('rules/:ruleId/toggle')
  toggleRule(
    @Param('ruleId') ruleId: string,
    @Body() body: { enabled: boolean },
  ) {
    const success = this.engine.setRuleEnabled(ruleId, body.enabled);
    if (!success) {
      throw new HttpException(
        `Rule ${ruleId} not found`,
        HttpStatus.NOT_FOUND,
      );
    }
    return {
      ruleId,
      enabled: body.enabled,
      message: `Rule ${ruleId} ${body.enabled ? 'activée' : 'désactivée'}`,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  MANUAL TRIGGER
  // ═══════════════════════════════════════════════════════════════

  /**
   * POST /api/decision-engine/:storeId/evaluate
   * Manually trigger rule evaluation for a store
   */
  @Post(':storeId/evaluate')
  @Throttle({ default: { ttl: 60000, limit: 4 } })
  async evaluateStore(@Param('storeId') storeId: string) {
    try {
      const decisions = await this.engine.evaluateStore(storeId);
      return {
        storeId,
        evaluatedAt: new Date().toISOString(),
        totalRulesEvaluated: this.engine.getRules().filter((r) => r.enabled)
          .length,
        decisions: decisions.map((d) => ({
          ruleId: d.ruleId,
          ruleName: d.ruleName,
          status: d.status,
          actions: d.actions.map((a) => ({
            type: a.type,
            success: a.success,
            result: a.result,
          })),
        })),
        executedCount: decisions.filter((d) => d.status === 'executed').length,
        skippedCount: decisions.filter((d) => d.status === 'skipped_cooldown')
          .length,
      };
    } catch (err: any) {
      this.logger.error(`Evaluate error: ${err.message}`);
      throw new HttpException(
        err.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * GET /api/decision-engine/:storeId/context
   * Get current context snapshot (debugging)
   */
  @Get(':storeId/context')
  async getContext(@Param('storeId') storeId: string) {
    try {
      const context = await this.engine.getContext(storeId);
      return context;
    } catch (err: any) {
      throw new HttpException(
        err.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  ALERTS
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET /api/decision-engine/:storeId/alerts
   * Get manager alerts
   */
  @Get(':storeId/alerts')
  getAlerts(
    @Param('storeId') storeId: string,
    @Query('unread') unread?: string,
  ) {
    const unreadOnly = unread === 'true' || unread === '1';
    const alerts = this.actions.getAlerts(storeId, unreadOnly);
    return {
      storeId,
      count: alerts.length,
      alerts,
    };
  }

  /**
   * PUT /api/decision-engine/:storeId/alerts/:alertId/read
   * Mark an alert as read
   */
  @Put(':storeId/alerts/:alertId/read')
  markAlertRead(
    @Param('storeId') storeId: string,
    @Param('alertId') alertId: string,
  ) {
    const success = this.actions.markAlertRead(storeId, alertId);
    if (!success) {
      throw new HttpException('Alert not found', HttpStatus.NOT_FOUND);
    }
    return { alertId, read: true };
  }

  // ═══════════════════════════════════════════════════════════════
  //  PRICE SUGGESTIONS
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET /api/decision-engine/:storeId/price-suggestions
   * Get price suggestions awaiting manager approval
   */
  @Get(':storeId/price-suggestions')
  getPriceSuggestions(@Param('storeId') storeId: string) {
    const suggestions = this.actions.getPriceSuggestions(storeId);
    return {
      storeId,
      count: suggestions.length,
      pending: suggestions.filter((s) => s.status === 'pending').length,
      suggestions,
    };
  }

  /**
   * PUT /api/decision-engine/:storeId/price-suggestions/:id
   * Accept or reject a price suggestion
   */
  @Put(':storeId/price-suggestions/:id')
  updateSuggestion(
    @Param('storeId') storeId: string,
    @Param('id') id: string,
    @Body() body: { status: 'accepted' | 'rejected' },
  ) {
    if (!['accepted', 'rejected'].includes(body.status)) {
      throw new HttpException(
        'Status must be "accepted" or "rejected"',
        HttpStatus.BAD_REQUEST,
      );
    }

    const success = this.actions.updateSuggestionStatus(
      storeId,
      id,
      body.status,
    );
    if (!success) {
      throw new HttpException(
        'Suggestion not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return { id, status: body.status };
  }

  // ═══════════════════════════════════════════════════════════════
  //  AUDIT
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET /api/decision-engine/:storeId/audit
   * Get audit trail
   */
  @Get(':storeId/audit')
  getAudit(
    @Param('storeId') storeId: string,
    @Query('limit') limitStr?: string,
    @Query('ruleId') ruleId?: string,
    @Query('status') status?: string,
    @Query('since') since?: string,
  ) {
    const limit = limitStr ? parseInt(limitStr, 10) : 50;
    const entries = this.audit.getEntries(storeId, {
      limit,
      ruleId,
      status,
      since,
    });

    return {
      storeId,
      count: entries.length,
      entries,
    };
  }

  /**
   * GET /api/decision-engine/:storeId/audit/stats
   * Get audit statistics
   */
  @Get(':storeId/audit/stats')
  getAuditStats(@Param('storeId') storeId: string) {
    return {
      storeId,
      ...this.audit.getStats(storeId),
    };
  }
}
