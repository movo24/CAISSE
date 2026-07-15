import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  ManyToOne, JoinColumn, Index,
} from 'typeorm';
import { ProductEntity } from './product.entity';
import { StockLocationEntity } from './stock-location.entity';

/**
 * StockMovement — immutable journal of every stock change.
 *
 * Every quantity change MUST create a movement. This is the audit trail.
 * StockBalance is derived from these movements.
 *
 * Movement types:
 * - supplier_receipt  → stock received from supplier
 * - transfer          → moved between locations (central → store, store → store)
 * - sale              → sold at POS (auto-created by SalesService)
 * - return_customer   → customer return
 * - return_supplier   → returned to supplier
 * - inventory_adjust  → correction after physical count
 * - loss_breakage     → broken / damaged
 * - loss_theft        → stolen
 * - loss_expired      → expired product
 * - loss_unknown      → unknown loss
 */
@Entity('stock_movements')
@Index(['productId', 'createdAt'])
@Index(['fromLocationId'])
@Index(['toLocationId'])
@Index(['movementType'])
@Index(['createdAt'])
export class StockMovementEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({
    name: 'movement_type',
    type: 'varchar',
    length: 30,
  })
  movementType:
    | 'supplier_receipt'
    | 'transfer'
    | 'sale'
    | 'pack_consumption'
    | 'return_customer'
    | 'return_supplier'
    | 'inventory_adjust'
    | 'loss_breakage'
    | 'loss_theft'
    | 'loss_expired'
    | 'loss_unknown';

  // For transfers: from → to. For receipts: from=null, to=central.
  // For sales: from=store, to=null. For losses: from=location, to=null.
  @Column({ name: 'from_location_id', type: 'uuid', nullable: true })
  fromLocationId: string | null;

  @Column({ name: 'to_location_id', type: 'uuid', nullable: true })
  toLocationId: string | null;

  @Column({ type: 'integer' })
  quantity: number; // Always positive. Direction determined by from/to.

  // Reference document (BL, PO number, ticket number)
  @Column({ type: 'varchar', length: 100, nullable: true })
  reference: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  reason: string;

  @Column({ type: 'varchar', nullable: true })
  note: string;

  // Who did this
  @Column({ name: 'employee_id', type: 'varchar', length: 100 })
  employeeId: string;

  @Column({ name: 'employee_name', type: 'varchar', length: 200 })
  employeeName: string;

  // ── Liaison vente (bloc F0, additif — renseigné à partir de F1) ──
  // Sale/return/void movements carry these; warehouse movements leave them NULL.
  @Column({ name: 'store_id', type: 'uuid', nullable: true })
  storeId: string | null;

  @Column({ name: 'sale_id', type: 'uuid', nullable: true })
  saleId: string | null;

  @Column({ name: 'sale_line_item_id', type: 'uuid', nullable: true })
  saleLineItemId: string | null;

  // Business time of the operation (e.g. real time of an offline sale replayed
  // later), distinct from created_at (server record time).
  @Column({ name: 'occurred_at', type: 'timestamp', nullable: true })
  occurredAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  // Relations
  @ManyToOne(() => ProductEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product: ProductEntity;

  @ManyToOne(() => StockLocationEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'from_location_id' })
  fromLocation: StockLocationEntity;

  @ManyToOne(() => StockLocationEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'to_location_id' })
  toLocation: StockLocationEntity;
}
