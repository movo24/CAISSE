import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { StoreEntity } from './store.entity';

/**
 * Statut d'enrôlement d'une machine POS (Partie B).
 *
 *  - `pending`  : la caisse a déclaré son identité, en attente de validation
 *                 par le back-office ;
 *  - `approved` : machine autorisée à vendre pour ce magasin ;
 *  - `rejected` : demande refusée (peut être re-soumise) ;
 *  - `revoked`  : machine précédemment approuvée puis désactivée.
 */
export type PosMachineStatus = 'pending' | 'approved' | 'rejected' | 'revoked';

/**
 * Enrôlement machine POS — identité matérielle déclarée par la caisse et
 * validée par le back-office.
 *
 * Flux : la caisse envoie `machineId` (empreinte matérielle stable) + le
 * magasin et le libellé du terminal → une demande `pending` est créée →
 * un manager/admin l'approuve depuis le back-office → la caisse devient
 * autorisée. Tant que la machine n'est pas `approved` ET que le magasin
 * applique l'enrôlement (`store.enrollment_enforced`), la vente est bloquée.
 *
 * Une seule ligne par `machineId` (ré-enrôlement = mise à jour de la ligne).
 */
@Entity('pos_machines')
@Index(['storeId', 'status'])
@Unique(['machineId'])
export class PosMachineEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Empreinte matérielle stable envoyée par la caisse (une par machine). */
  @Column({ name: 'machine_id', type: 'varchar' })
  machineId: string;

  @Column({ name: 'store_id', type: 'varchar' })
  storeId: string;

  @ManyToOne(() => StoreEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'store_id' })
  store: StoreEntity;

  /** Libellé libre du terminal (ex. « Caisse 1 »). */
  @Column({ name: 'terminal_label', type: 'varchar' })
  terminalLabel: string;

  /** Nom convivial / hostname de la machine (facultatif). */
  @Column({ name: 'machine_name', type: 'varchar', nullable: true })
  machineName: string | null;

  /** Plateforme déclarée (ex. « win32 »), purement informatif. */
  @Column({ name: 'platform', type: 'varchar', nullable: true })
  platform: string | null;

  /** Version applicative au moment de la demande (informatif). */
  @Column({ name: 'app_version', type: 'varchar', nullable: true })
  appVersion: string | null;

  @Column({ type: 'varchar', default: 'pending' })
  status: PosMachineStatus;

  /** Contexte ayant déclenché la demande (employé connecté, si présent). */
  @Column({ name: 'requested_by', type: 'varchar', nullable: true })
  requestedBy: string | null;

  // ── Décision back-office ──

  @Column({ name: 'decided_by', type: 'varchar', nullable: true })
  decidedBy: string | null;

  @Column({ name: 'decided_at', type: 'timestamp', nullable: true })
  decidedAt: Date | null;

  /** Motif de refus / révocation (traçabilité). */
  @Column({ name: 'decision_reason', type: 'varchar', nullable: true })
  decisionReason: string | null;

  /** Dernière fois que la machine a interrogé son statut / vendu. */
  @Column({ name: 'last_seen_at', type: 'timestamp', nullable: true })
  lastSeenAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
