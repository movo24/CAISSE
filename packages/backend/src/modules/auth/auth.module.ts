import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { WebauthnService } from './webauthn.service';
import { WebauthnController } from './webauthn.controller';
import { JwtStrategy } from './jwt.strategy';
import { StoreEntity } from '../../database/entities/store.entity';
import { EmployeeEntity } from '../../database/entities/employee.entity';
import { PosSessionEntity } from '../../database/entities/pos-session.entity';
import { WebauthnCredentialEntity } from '../../database/entities/webauthn-credential.entity';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    AuditModule,
    PassportModule,
    JwtModule.register({
      secret: (() => {
        const secret = process.env.JWT_SECRET;
        if (!secret || secret === 'dev-jwt-secret') {
          throw new Error(
            'JWT_SECRET is not set or is using the insecure default. ' +
            'Set a strong JWT_SECRET in your .env file (min 32 chars).',
          );
        }
        return secret;
      })(),
      signOptions: { expiresIn: '15m' },
    }),
    TypeOrmModule.forFeature([StoreEntity, EmployeeEntity, PosSessionEntity, WebauthnCredentialEntity]),
  ],
  controllers: [AuthController, WebauthnController],
  providers: [AuthService, JwtStrategy, WebauthnService],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
