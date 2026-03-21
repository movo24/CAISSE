import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthService } from './auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private authService: AuthService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET!,
    });
  }

  async validate(payload: any) {
    const employee = await this.authService.validateEmployee(payload.sub);
    if (!employee) throw new UnauthorizedException();
    return {
      employeeId: payload.sub,
      storeId: payload.storeId,
      role: payload.role,
      employeeName: payload.employeeName,
      maxDiscount: payload.maxDiscount,
    };
  }
}
