import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * P370 — Clé d'accès WebAuthn/FIDO2 (passkey) d'un employé.
 *
 * SEULES les informations PUBLIQUES nécessaires à la vérification
 * cryptographique sont stockées : identifiant de credential, clé publique
 * COSE, compteur de signature. Aucune clé privée, aucune donnée biométrique,
 * aucune image — la biométrie reste entièrement gérée par l'OS de
 * l'utilisateur (Face ID / Touch ID / Windows Hello / Android).
 */
@Entity('webauthn_credentials')
@Index(['employeeId'])
@Index(['credentialId'], { unique: true })
export class WebauthnCredentialEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Compte central The Wesley (employees.id). */
  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId: string;

  /** Identifiant de credential WebAuthn (base64url) — public. */
  @Column({ name: 'credential_id', type: 'text' })
  credentialId: string;

  /** Clé PUBLIQUE COSE (base64url) — sert uniquement à vérifier les signatures. */
  @Column({ name: 'public_key', type: 'text' })
  publicKey: string;

  /** Compteur de signature (anti-clonage) — vérifié quand l'authenticator le fournit. */
  @Column({ type: 'bigint', default: 0 })
  counter: string;

  /** Transports annoncés (JSON: ["internal","hybrid",…]) — hint client. */
  @Column({ type: 'varchar', nullable: true })
  transports: string | null;

  /** Nom lisible choisi par l'utilisateur (« iPhone d'Omar »). */
  @Column({ name: 'device_name', type: 'varchar', length: 100 })
  deviceName: string;

  /** singleDevice | multiDevice (passkey synchronisée). */
  @Column({ name: 'device_type', type: 'varchar', nullable: true })
  deviceType: string | null;

  @Column({ name: 'backed_up', type: 'boolean', default: false })
  backedUp: boolean;

  /** Modèle d'authenticator (public, fourni par l'attestation). */
  @Column({ type: 'varchar', nullable: true })
  aaguid: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'last_used_at', type: 'timestamp', nullable: true })
  lastUsedAt: Date | null;

  /** Révocation (clé perdue/inconnue) — refus immédiat, jamais supprimée (audit). */
  @Column({ name: 'revoked_at', type: 'timestamp', nullable: true })
  revokedAt: Date | null;
}
