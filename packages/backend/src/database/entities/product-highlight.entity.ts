import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export type HighlightCategory =
  | 'BEAUTY'
  | 'SNACK'
  | 'ACCESSORY'
  | 'GADGET'
  | 'CANDY'
  | 'TREND';

@Entity('product_highlights')
@Index(['active'])
export class ProductHighlightEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'product_id', type: 'uuid', nullable: true })
  productId: string | null;

  @Column({ length: 200 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'image_url', type: 'text', nullable: true })
  imageUrl: string | null;

  @Column({ length: 30, nullable: true })
  category: HighlightCategory | null;

  @Column({ name: 'is_new', default: true })
  isNew: boolean;

  @Column({ name: 'is_viral', default: false })
  isViral: boolean;

  @Column({ default: true })
  active: boolean;

  @Column({ name: 'starts_at', type: 'timestamp', nullable: true })
  startsAt: Date | null;

  @Column({ name: 'ends_at', type: 'timestamp', nullable: true })
  endsAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
