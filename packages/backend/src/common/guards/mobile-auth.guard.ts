import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';

/**
 * MobileAuthGuard — validates customer JWT (audience='mobile-app').
 *
 * Strictly separated from employee JWT (JwtAuthGuard) — the 'aud' claim
 * is mandatory and must equal 'mobile-app'. This prevents an employee
 * token from accessing mobile customer routes and vice versa.
 */
@Injectable()
export class MobileAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token requis');
    }

    const token = authHeader.slice(7);
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new UnauthorizedException('Configuration serveur invalide');
    }

    try {
      const payload = jwt.verify(token, secret, {
        audience: 'mobile-app',
      }) as { sub: string; aud: string };

      if (payload.aud !== 'mobile-app') {
        throw new UnauthorizedException('Token non valide pour cette ressource');
      }

      req.customer = { id: payload.sub };
      return true;
    } catch (err: any) {
      if (err.name === 'TokenExpiredError') {
        throw new UnauthorizedException('Token expiré');
      }
      throw new UnauthorizedException('Token invalide');
    }
  }
}
