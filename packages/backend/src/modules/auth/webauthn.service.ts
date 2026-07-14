import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { randomBytes } from 'crypto';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { isoUint8Array } from '@simplewebauthn/server/helpers';

import { AuthService } from './auth.service';
import { AuditService } from '../audit/audit.service';
import { CACHE_STORE } from '../../common/cache/cache.module';
import { ICacheStore } from '../../common/cache/cache-store';
import { EmployeeEntity } from '../../database/entities/employee.entity';
import { WebauthnCredentialEntity } from '../../database/entities/webauthn-credential.entity';

/** TTL du challenge : usage unique, durée de vie courte (anti-rejeu). */
const CHALLENGE_TTL_SECONDS = 120;
const AUDIT_STORE_FALLBACK = '_admin';

/**
 * P370 — Passkeys WebAuthn/FIDO2 (Face ID / Touch ID / Windows Hello /
 * Android / clé de sécurité). AUCUNE biométrie maison : la vérification
 * biométrique est faite par l'OS ; le serveur ne voit et ne stocke que la
 * clé PUBLIQUE et vérifie des signatures.
 *
 * Sécurité :
 *  - challenge aléatoire serveur, usage unique (get+del), TTL 120 s ;
 *  - origin et RP ID vérifiés strictement (WEBAUTHN_ORIGINS / WEBAUTHN_RP_ID) ;
 *  - compteur de signature vérifié quand l'authenticator le fournit
 *    (régression = rejet + audit, anti-clonage) ;
 *  - la passkey AUTHENTIFIE, elle ne donne aucun droit : rôle et périmètre
 *    sont relus en base à chaque session (compte désactivé → refus) ;
 *  - credentials liées au compte : liste/renommage/révocation strictement
 *    filtrées par l'employé du JWT (pas de fuite entre comptes/tenants).
 */
@Injectable()
export class WebauthnService {
  private readonly logger = new Logger(WebauthnService.name);

  constructor(
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
    @Inject(CACHE_STORE) private readonly cache: ICacheStore,
    @InjectRepository(EmployeeEntity)
    private readonly employeeRepo: Repository<EmployeeEntity>,
    @InjectRepository(WebauthnCredentialEntity)
    private readonly credentialRepo: Repository<WebauthnCredentialEntity>,
  ) {}

  /** RP ID = domaine (jamais d'origine complète). Par défaut : localhost (dev). */
  private rpId(): string {
    return process.env.WEBAUTHN_RP_ID || 'localhost';
  }

  /** Origins EXACTES autorisées (schéma+hôte+port). HTTPS requis hors local. */
  private expectedOrigins(): string[] {
    const fromEnv = (process.env.WEBAUTHN_ORIGINS || '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    if (fromEnv.length) return fromEnv;
    // Dev local uniquement — en production WEBAUTHN_ORIGINS doit être défini (https).
    return ['http://localhost:5176', 'http://localhost:5173'];
  }

  private async activeCredentials(employeeId: string): Promise<WebauthnCredentialEntity[]> {
    return this.credentialRepo.find({
      where: { employeeId, revokedAt: IsNull() },
      order: { createdAt: 'ASC' },
    });
  }

  private audit(employeeId: string, storeId: string | null, action: string, details: Record<string, unknown>) {
    return this.auditService
      .log({
        storeId: storeId || AUDIT_STORE_FALLBACK,
        employeeId,
        action,
        entityType: 'webauthn_credential',
        entityId: (details.credentialDbId as string) || employeeId,
        details,
      })
      .catch(() => {
        /* l'audit ne doit jamais casser l'authentification */
      });
  }

  // ── Enregistrement (utilisateur DÉJÀ authentifié par l'auth centrale) ──────

  async registrationOptions(employeeId: string) {
    const emp = await this.employeeRepo.findOne({ where: { id: employeeId, isActive: true } });
    if (!emp) throw new UnauthorizedException('Compte introuvable ou désactivé');

    const existing = await this.activeCredentials(employeeId);
    const options = await generateRegistrationOptions({
      rpName: 'The Wesley Control',
      rpID: this.rpId(),
      userID: isoUint8Array.fromUTF8String(emp.id),
      userName: emp.email || emp.qrCode,
      userDisplayName: `${emp.firstName} ${emp.lastName}`,
      attestationType: 'none',
      // Passkey découvrable privilégiée → connexion sans saisie d'email.
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
      excludeCredentials: existing.map((c) => ({
        id: c.credentialId,
        transports: c.transports ? JSON.parse(c.transports) : undefined,
      })),
    });

    // Challenge à usage unique, lié au compte, TTL court.
    await this.cache.set(`webauthn:reg:${employeeId}`, options.challenge, CHALLENGE_TTL_SECONDS);
    return options;
  }

  async verifyRegistration(employeeId: string, body: { response: any; deviceName?: string }) {
    const emp = await this.employeeRepo.findOne({ where: { id: employeeId, isActive: true } });
    if (!emp) throw new UnauthorizedException('Compte introuvable ou désactivé');

    const expectedChallenge = await this.cache.get<string>(`webauthn:reg:${employeeId}`);
    // Usage unique : consommé immédiatement, un rejeu retombe sur « expiré ».
    await this.cache.del(`webauthn:reg:${employeeId}`);
    if (!expectedChallenge) {
      throw new BadRequestException('Challenge expiré ou déjà utilisé — relancez l’activation.');
    }

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.response,
        expectedChallenge,
        expectedOrigin: this.expectedOrigins(),
        expectedRPID: this.rpId(),
        requireUserVerification: false,
      });
    } catch (e: any) {
      throw new BadRequestException(`Enregistrement refusé : ${e.message}`);
    }
    if (!verification.verified || !verification.registrationInfo) {
      throw new BadRequestException('Enregistrement WebAuthn non vérifié');
    }

    const info = verification.registrationInfo;
    const deviceName = (body.deviceName || 'Nouvel appareil').slice(0, 100);
    const saved = await this.credentialRepo.save(
      this.credentialRepo.create({
        employeeId,
        credentialId: info.credential.id,
        publicKey: Buffer.from(info.credential.publicKey).toString('base64url'),
        counter: String(info.credential.counter ?? 0),
        transports: info.credential.transports ? JSON.stringify(info.credential.transports) : null,
        deviceName,
        deviceType: info.credentialDeviceType ?? null,
        backedUp: !!info.credentialBackedUp,
        aaguid: info.aaguid ?? null,
      }),
    );

    await this.audit(employeeId, emp.storeId, 'webauthn_register', {
      credentialDbId: saved.id,
      deviceName,
      deviceType: saved.deviceType,
      backedUp: saved.backedUp,
    });
    this.logger.log(`[WEBAUTHN] Passkey enregistrée pour ${emp.email} (« ${deviceName} »)`);
    return this.toDto(saved);
  }

  // ── Authentification (publique, sans email : passkey découvrable) ──────────

  async authenticationOptions() {
    const options = await generateAuthenticationOptions({
      rpID: this.rpId(),
      userVerification: 'preferred',
      // allowCredentials vide → credentials découvrables (usernameless).
    });
    // Le challenge est référencé par un identifiant opaque aléatoire —
    // jamais rejouable, jamais lié à un compte fourni par le client.
    const challengeId = randomBytes(24).toString('base64url');
    await this.cache.set(`webauthn:auth:${challengeId}`, options.challenge, CHALLENGE_TTL_SECONDS);
    return { challengeId, options };
  }

  async verifyAuthentication(body: { challengeId?: string; response?: any }) {
    if (!body?.challengeId || !body?.response?.id) {
      throw new BadRequestException('challengeId et response requis');
    }
    const expectedChallenge = await this.cache.get<string>(`webauthn:auth:${body.challengeId}`);
    await this.cache.del(`webauthn:auth:${body.challengeId}`); // usage unique (anti-rejeu)
    if (!expectedChallenge) {
      throw new UnauthorizedException('Challenge expiré ou déjà utilisé');
    }

    // La credential détermine LE compte — aucun identifiant client n'est cru.
    const cred = await this.credentialRepo.findOne({
      where: { credentialId: body.response.id },
    });
    if (!cred || cred.revokedAt) {
      throw new UnauthorizedException('Clé d’accès inconnue ou révoquée');
    }
    const emp = await this.employeeRepo.findOne({ where: { id: cred.employeeId } });
    if (!emp || !emp.isActive) {
      throw new UnauthorizedException('Compte désactivé');
    }

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: body.response,
        expectedChallenge,
        expectedOrigin: this.expectedOrigins(),
        expectedRPID: this.rpId(),
        credential: {
          id: cred.credentialId,
          publicKey: new Uint8Array(Buffer.from(cred.publicKey, 'base64url')),
          counter: Number(cred.counter),
          transports: cred.transports ? JSON.parse(cred.transports) : undefined,
        },
        requireUserVerification: false,
      });
    } catch (e: any) {
      throw new UnauthorizedException(`Authentification refusée : ${e.message}`);
    }
    if (!verification.verified) {
      throw new UnauthorizedException('Signature WebAuthn invalide');
    }

    // Compteur de signature : une régression signale un clonage possible.
    const newCounter = verification.authenticationInfo.newCounter;
    const previous = Number(cred.counter);
    if (newCounter > 0 && previous > 0 && newCounter <= previous) {
      await this.audit(emp.id, emp.storeId, 'webauthn_counter_anomaly', {
        credentialDbId: cred.id,
        previousCounter: previous,
        receivedCounter: newCounter,
      });
      throw new UnauthorizedException(
        'Anomalie de compteur détectée — connexion refusée. Révoquez cette clé si vous ne la reconnaissez pas.',
      );
    }
    cred.counter = String(newCounter);
    cred.lastUsedAt = new Date();
    await this.credentialRepo.save(cred);

    // Les DROITS viennent de la base à l'instant T (rôle, périmètre) —
    // la passkey n'en décide jamais.
    const session = await this.authService.createSessionForEmployee(emp);
    await this.audit(emp.id, emp.storeId, 'webauthn_login', {
      credentialDbId: cred.id,
      deviceName: cred.deviceName,
    });
    this.logger.log(`[WEBAUTHN] Login OK: ${emp.email} via « ${cred.deviceName} » (${emp.role})`);
    return session;
  }

  // ── Gestion « Mes appareils et clés d'accès » (compte du JWT uniquement) ───

  private toDto(c: WebauthnCredentialEntity) {
    return {
      id: c.id,
      deviceName: c.deviceName,
      deviceType: c.deviceType,
      backedUp: c.backedUp,
      createdAt: c.createdAt,
      lastUsedAt: c.lastUsedAt,
      revokedAt: c.revokedAt,
    };
  }

  async list(employeeId: string) {
    const creds = await this.credentialRepo.find({
      where: { employeeId },
      order: { createdAt: 'ASC' },
    });
    return creds.map((c) => this.toDto(c));
  }

  async rename(employeeId: string, id: string, name: string) {
    const cred = await this.credentialRepo.findOne({ where: { id, employeeId } });
    if (!cred) throw new NotFoundException('Clé d’accès introuvable');
    const clean = (name || '').trim().slice(0, 100);
    if (!clean) throw new BadRequestException('Nom requis');
    cred.deviceName = clean;
    await this.credentialRepo.save(cred);
    return this.toDto(cred);
  }

  async revoke(employeeId: string, id: string) {
    const cred = await this.credentialRepo.findOne({ where: { id, employeeId } });
    if (!cred) throw new NotFoundException('Clé d’accès introuvable');
    if (!cred.revokedAt) {
      cred.revokedAt = new Date();
      await this.credentialRepo.save(cred);
      const emp = await this.employeeRepo.findOne({ where: { id: employeeId } });
      // Toute révocation est journalisée dans l'audit de sécurité.
      await this.audit(employeeId, emp?.storeId ?? null, 'webauthn_revoke', {
        credentialDbId: cred.id,
        deviceName: cred.deviceName,
      });
      this.logger.warn(`[WEBAUTHN] Passkey révoquée (« ${cred.deviceName} ») pour employé ${employeeId}`);
    }
    return this.toDto(cred);
  }
}
