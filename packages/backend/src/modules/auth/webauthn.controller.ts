import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WebauthnService } from './webauthn.service';

/**
 * P370 — Endpoints Passkey WebAuthn/FIDO2. SÉPARÉS des routes analytics
 * lecture seule (`/mobile/v1/analytics/*` reste 100 % GET) : ce contrôleur
 * appartient au périmètre AUTH, comme /auth/login/*.
 *
 * Anti-abus : throttling strict (brute force), challenge serveur à usage
 * unique + TTL court (anti-rejeu), origin/RP ID vérifiés (anti-phishing),
 * pas de CSRF exploitable (API Bearer, aucune session cookie ; le login
 * exige une signature fraîche du challenge serveur), credential↔compte
 * résolue côté serveur (anti-usurpation), gestion filtrée par le JWT
 * (aucune fuite entre comptes/tenants).
 */
@ApiTags('auth-webauthn')
@Controller('auth/webauthn')
export class WebauthnController {
  constructor(private readonly service: WebauthnService) {}

  // ── Enregistrement : réservé à un utilisateur DÉJÀ authentifié ────────────

  @Post('register/options')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Options d’enregistrement d’une passkey (compte du JWT uniquement)' })
  registrationOptions(@Req() req: any) {
    return this.service.registrationOptions(req.user.employeeId ?? req.user.sub ?? req.user.id);
  }

  @Post('register/verify')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Validation de l’enregistrement (attestation) + nom d’appareil' })
  verifyRegistration(@Req() req: any, @Body() body: { response: any; deviceName?: string }) {
    return this.service.verifyRegistration(req.user.employeeId ?? req.user.sub ?? req.user.id, body);
  }

  // ── Authentification : publique (le challenge signé est la preuve) ────────

  @Post('login/options')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Options d’authentification passkey (découvrable, sans email)' })
  authenticationOptions() {
    return this.service.authenticationOptions();
  }

  @Post('login/verify')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Validation de la signature WebAuthn → session (rôle/périmètre relus en base)' })
  verifyAuthentication(@Body() body: { challengeId?: string; response?: any }) {
    return this.service.verifyAuthentication(body);
  }

  // ── « Mes appareils et clés d'accès » ──────────────────────────────────────

  @Get('credentials')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Liste des clés d’accès du compte (nom, création, dernière utilisation)' })
  list(@Req() req: any) {
    return this.service.list(req.user.employeeId ?? req.user.sub ?? req.user.id);
  }

  @Patch('credentials/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Renommer un appareil' })
  rename(@Req() req: any, @Param('id') id: string, @Body() body: { name?: string }) {
    return this.service.rename(req.user.employeeId ?? req.user.sub ?? req.user.id, id, body?.name ?? '');
  }

  @Delete('credentials/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Révoquer une clé perdue ou inconnue (journalisé dans l’audit)' })
  revoke(@Req() req: any, @Param('id') id: string) {
    return this.service.revoke(req.user.employeeId ?? req.user.sub ?? req.user.id, id);
  }
}
