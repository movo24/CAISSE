import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * POS Terminal — the LOGICAL till (register), store-scoped.
 *
 * This is the first brick of the (1b) binding work: it gives the free-text
 * `pos_sessions.terminal_id` (introduced by γ, fed from X-Terminal-Id) a
 * referent. Without a registry, X-Terminal-Id is an unvalidated client
 * assertion; with it, the claim can be checked against the JWT's store
 * (stops cross-store spoofing).
 *
 * DISTINCT from PaymentTerminalEntity (`payment_terminals`): that is the
 * Stripe card READER hardware (WisePad, stripe_reader_id, battery). This is
 * the till identity an operator's session binds to. A future link between
 * the two (a reader attached to a till) is deferred — not part of this brick.
 *
 * Trust-model note (#4): this registry validation unblocks (1b) DEVELOPMENT
 * by stopping cross-store spoofing. It does NOT stop intra-store spoofing
 * (an operator can still claim "Caisse-2" instead of "Caisse-1" within their
 * store). Making session-sourced attribution FISCALLY AUTHORITATIVE remains
 * gated on a per-terminal device credential. This entity is the referent,
 * not the trust anchor.
 */
@Entity('pos_terminals')
@Index(['storeId', 'isActive'])
// One active terminal_code per store — enforced at the DB level (partial
// unique index), NOT by check-then-insert (the γ TOCTOU lesson applied up
// front). The service catches 23505 and maps it to 409; the constraint is
// the atomic arbiter of concurrent provisioning.
@Index(['storeId', 'terminalCode'], { unique: true, where: '"is_active"' })
export class PosTerminalEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id' })
  storeId: string;

  /**
   * The identifier an operator's terminal declares via X-Terminal-Id.
   * Unique among active terminals within a store.
   */
  @Column({ name: 'terminal_code' })
  terminalCode: string;

  /** Human-readable label, e.g. "Caisse 1". */
  @Column({ type: 'varchar', nullable: true })
  label: string | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
