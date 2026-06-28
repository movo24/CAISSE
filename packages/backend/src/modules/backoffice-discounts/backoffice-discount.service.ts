import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';

import {
  evaluateManualDiscount,
  DiscountPolicyViolation,
  DiscountPolicyResult,
} from '../sales/discount-policy';
import { AuditService } from '../audit/audit.service';

export interface BackofficeDiscountRequest {
  storeId: string;
  subtotalMinorUnits: number;
  discountMinorUnits: number;
  justification?: string;
  actorEmployeeId: string;
  actorRole: string;
}

/**
 * POS-054e — Back-office discount authorization (SEPARATE from the POS terminal path).
 *
 * Back-office may authorize up to 100%, but only for admin/central roles, and any
 * discount > 30% requires a motif (justification) + a validator (the authenticated admin)
 * + an append-only audit entry. This service NEVER runs on a store terminal: the POS
 * `createSale` path always uses channel 'pos' (hard 30% cap). This endpoint is admin-gated
 * by RolesGuard AND re-checked by the policy (defense in depth).
 *
 * NOTE: this authorizes/records a back-office discount decision. Applying it to a specific
 * sale/ticket mutation is a follow-up (POS-054e-apply) and is intentionally not bundled here.
 */
@Injectable()
export class BackofficeDiscountService {
  private readonly logger = new Logger(BackofficeDiscountService.name);

  constructor(private readonly auditService: AuditService) {}

  async authorize(req: BackofficeDiscountRequest): Promise<DiscountPolicyResult> {
    try {
      const verdict = evaluateManualDiscount({
        channel: 'backoffice',
        subtotalMinorUnits: req.subtotalMinorUnits,
        manualDiscountMinorUnits: req.discountMinorUnits,
        // The authenticated admin IS the validator for the back-office channel.
        responsableCodeProvided: true,
        justification: req.justification,
        actorRole: req.actorRole,
      });
      await this.audit(req, 'backoffice_discount_authorized', {
        discountPct: verdict.discountPct,
      });
      return verdict;
    } catch (e) {
      if (e instanceof DiscountPolicyViolation) {
        await this.audit(req, 'backoffice_discount_blocked', { code: e.code });
        if (e.code === 'BACKOFFICE_FORBIDDEN_ROLE') {
          throw new ForbiddenException(e.message);
        }
        throw new BadRequestException(e.message);
      }
      throw e;
    }
  }

  private async audit(
    req: BackofficeDiscountRequest,
    action: string,
    extra: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.auditService.log({
        storeId: req.storeId,
        employeeId: req.actorEmployeeId,
        action,
        entityType: 'backoffice_discount',
        entityId: req.storeId, // store-scoped authorization (no sale entity bound yet)
        details: {
          ...extra,
          subtotalMinorUnits: req.subtotalMinorUnits,
          discountMinorUnits: req.discountMinorUnits,
          justification: req.justification ?? null,
          actorRole: req.actorRole,
        },
      });
    } catch (e: any) {
      this.logger.warn(`Audit (${action}) failed: ${e?.message}`);
    }
  }
}
