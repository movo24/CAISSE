import { Injectable, CanActivate, ExecutionContext, SetMetadata, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { roleSatisfies } from './role-hierarchy';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Role hierarchy: admin > manager > cashier (see ./role-hierarchy.ts, unit-tested).
 * A higher role always inherits lower role permissions.
 * Example: @Roles('manager') allows both 'manager' and 'admin'.
 */

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

    // User passes if their role level >= any required role level (admin>manager>cashier).
    const hasAccess = roleSatisfies(user.role, requiredRoles);

    if (!hasAccess) {
      throw new ForbiddenException(
        `Acces refuse : role « ${requiredRoles.join(', ')} » requis. Votre role : ${user.role}.`,
      );
    }
    return true;
  }
}
