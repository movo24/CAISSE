import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * POS Session — tracks an employee's active register session.
 * Created when employee logs in (via TimeWin24 auth).
 * Closed when employee logs out or session expires.
 *
 * Contains SNAPSHOTS of TimeWin24 data — not live references.
 * This ensures the POS works offline and preserves historical context.
 */
@Entity('pos_sessions')
@Index(['storeId', 'isActive'])
@Index(['employeeId', 'isActive'])
// γ invariant at the DB level: ONE active session per (store, terminal).
// In prod this is the partial unique index created by migration 1719
// (uq_pos_sessions_store_terminal_active ... WHERE is_active). The entity
// declares it too so synchronize-based test DBs carry the same constraint.
@Index(['storeId', 'terminalId'], { unique: true, where: '"is_active"' })
export class PosSessionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id' })
  storeId: string;

  /** TimeWin24 employee UUID — NOT a foreign key (lives in TW24 DB) */
  @Column({ name: 'employee_id' })
  employeeId: string;

  /**
   * Physical terminal identifier (γ-model, D1 decision), captured from the
   * X-Terminal-Id header at session open. Uniqueness invariant is
   * applicative: ONE active session per (storeId, terminalId). Nullable at
   * the DB level (additive migration); the application refuses to open a
   * session without it, so every new row carries one.
   */
  @Column({ name: 'terminal_id', type: 'varchar', nullable: true })
  terminalId: string | null;

  /** Snapshot: employee name at session start */
  @Column({ name: 'employee_name' })
  employeeName: string;

  /** Snapshot: role at session start */
  @Column({ name: 'employee_role' })
  employeeRole: string;

  /** Snapshot: max discount at session start */
  @Column({ name: 'max_discount', type: 'decimal', default: 0 })
  maxDiscount: number;

  /** Full permissions snapshot from TimeWin24 */
  @Column({ type: 'jsonb', default: '{}' })
  permissions: Record<string, boolean | number>;

  /** TimeWin24 session token (for event correlation) */
  @Column({ name: 'timewin_session_token', nullable: true })
  timewinSessionToken: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'opened_at' })
  openedAt: Date;

  @Column({ name: 'closed_at', nullable: true })
  closedAt: Date;

  /** Was this session started in offline mode? */
  @Column({ name: 'offline_mode', default: false })
  offlineMode: boolean;

  /**
   * P351 (POS-016) — fond de caisse déclaré à l'OUVERTURE, en centimes.
   * Nullable : les sessions antérieures à la migration 1728 n'en ont pas.
   */
  @Column({ name: 'opening_float_minor_units', type: 'int', nullable: true })
  openingFloatMinorUnits: number | null;

  /**
   * P351 (POS-017) — espèces COMPTÉES à la clôture, en centimes.
   * Persisté uniquement si l'opérateur a saisi un comptage.
   */
  @Column({ name: 'counted_cash_minor_units', type: 'int', nullable: true })
  countedCashMinorUnits: number | null;

  /**
   * P351 — écart signé calculé CÔTÉ SERVEUR à la clôture :
   * compté − (fond de caisse + espèces des ventes stampées de la session).
   * Figé à la clôture (le contrôle s'appuie dessus) — jamais recalculé.
   */
  @Column({ name: 'cash_variance_minor_units', type: 'int', nullable: true })
  cashVarianceMinorUnits: number | null;
}
