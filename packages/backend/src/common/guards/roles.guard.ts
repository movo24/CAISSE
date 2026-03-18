import { Injectable, CanActivate, ExecutionContext, SetMetadata, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Role hierarchy: admin > manager > cashier
 *
 * Mapping to business roles:
 *   admin        = super_admin / org_admin (full access, multi-store)
 *   manager      = store_manager (assigned stores, operational access)
 *   cashier      = employee (POS only, read-only backoffice)
 *
 * A higher role always inherits lower role permissions.
 * Example: @Roles('manager') allows both 'manager' and 'admin'.
 */
const ROLE_HIERARCHY: Record<string, number> = {
  cashier: 0,
  manager: 1,
  admin: 2,
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) {
      throw new ForbiddenException('Authentification requise.');
    }

    const userLevel = ROLE_HIERARCHY[user.role] ?? -1;
    // User passes if their level >= any required role level
    const hasAccess = requiredRoles.some(
      (role) => userLevel >= (ROLE_HIERARCHY[role] ?? Infinity),
    );

    if (!hasAccess) {
      throw new ForbiddenException(
        `Acces refuse : role « ${requiredRoles.join(', ')} » requis. Votre role : ${user.role}.`,
      );
    }
    return true;
  }
}
