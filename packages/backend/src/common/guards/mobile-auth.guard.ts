import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import * as jwt from 'jsonwebtoken';
import { CustomerEntity } from '../../database/entities/customer.entity';

/**
 * MobileAuthGuard — validates customer JWT (audience='mobile-app').
 *
 * - Audience isolation: the 'aud' claim is mandatory and must equal 'mobile-app',
 *   so an employee JWT can never reach mobile customer routes (and vice versa).
 * - Revocation: the customer must still exist, not be soft-deleted, and the token's
 *   `tv` (tokenVersion) must match the current one. logout / soft-delete / security
 *   reset bump tokenVersion, instantly invalidating every previously-issued token.
 */
@Injectable()
export class MobileAuthGuard implements CanActivate {
  constructor(
    @InjectRepository(CustomerEntity)
    private readonly customerRepo: Repository<CustomerEntity>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
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

    let payload: { sub: string; aud?: string; tv?: number };
    try {
      payload = jwt.verify(token, secret, { audience: 'mobile-app' }) as any;
    } catch (err: any) {
      if (err.name === 'TokenExpiredError') {
        throw new UnauthorizedException('Token expiré');
      }
      throw new UnauthorizedException('Token invalide');
    }

    if (payload.aud !== 'mobile-app') {
      throw new UnauthorizedException('Token non valide pour cette ressource');
    }

    // Revocation check: existence + not soft-deleted + current token version.
    const customer = await this.customerRepo.findOne({
      where: { id: payload.sub, deletedAt: IsNull() } as any,
    });
    if (!customer) {
      throw new UnauthorizedException('Compte introuvable');
    }
    if ((payload.tv ?? -1) !== customer.tokenVersion) {
      throw new UnauthorizedException('Token révoqué');
    }

    req.customer = { id: payload.sub };
    return true;
  }
}
