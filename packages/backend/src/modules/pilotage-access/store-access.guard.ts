import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessService } from './access.service';
import { REQUIRE_STORE_ACCESS, RequireStoreAccessMeta } from './require-store-access.decorator';
import { AccessDenyReason } from './application-access.constants';

/** Raison interne → code HTTP exposé (spec §5). */
const REASON_TO_CODE: Record<AccessDenyReason, string> = {
  ACCOUNT_INACTIVE: 'FORBIDDEN',
  NO_APPLICATION_ACCESS: 'FORBIDDEN',
  STORE_NOT_IN_SCOPE: 'FORBIDDEN',
  PERMISSION_DENIED: 'FORBIDDEN',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  ACCESS_EXPIRED: 'ACCESS_EXPIRED',
};

const CODE_MESSAGE: Record<string, string> = {
  FORBIDDEN: 'Accès refusé à ce magasin.',
  ACCOUNT_SUSPENDED: 'Compte suspendu.',
  ACCESS_EXPIRED: 'Accès expiré.',
};

/** Collecte les magasins ciblés par la requête (params/query/body), dédupliqués. */
function extractStoreIds(req: any): string[] {
  const out = new Set<string>();
  const single = req.params?.storeId ?? req.query?.storeId ?? req.body?.storeId;
  if (single) out.add(String(single));
  const many = req.query?.storeIds ?? req.body?.storeIds;
  if (Array.isArray(many)) many.forEach((s) => s && out.add(String(s)));
  else if (typeof many === 'string') many.split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => out.add(s));
  return [...out];
}

/**
 * Contrôle serveur OBLIGATOIRE du périmètre magasin (spec §5).
 *
 * La modification manuelle de l'URL / query / body ne peut pas contourner le scoping :
 * CHAQUE magasin ciblé est vérifié via AccessService. Un seul refus → 403.
 * L'admin POS conserve un périmètre global (compat back-office existant).
 */
@Injectable()
export class StoreAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<RequireStoreAccessMeta>(REQUIRE_STORE_ACCESS, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!meta) return true; // endpoint non gardé par ce guard

    const req = ctx.switchToHttp().getRequest();
    const user = req.user;
    if (!user?.employeeId) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Non authentifié.' });
    }

    // Admin POS = périmètre global (le back-office actuel gate déjà sur admin).
    if (user.role === 'admin') {
      req.accessScope = { global: true, storeIds: [] };
      return true;
    }

    const targets = extractStoreIds(req);
    const stores: (string | undefined)[] = targets.length ? targets : [undefined];
    for (const storeId of stores) {
      const res = await this.access.resolveEffectiveAccess({
        employeeId: user.employeeId,
        storeId,
        permission: meta.permission,
        accountActive: true, // req.user existe ⇒ validateEmployee a déjà confirmé is_active
      });
      if (!res.allowed) {
        const code = res.reason ? REASON_TO_CODE[res.reason] : 'FORBIDDEN';
        throw new ForbiddenException({
          code,
          reason: res.reason,
          storeId,
          message: CODE_MESSAGE[code] ?? 'Accès refusé.',
        });
      }
    }
    return true;
  }
}
