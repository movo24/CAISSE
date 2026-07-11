import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { AttractMediaEntity } from './attract-media.entity';

/**
 * Campagne attract = playlist ordonnée diffusée sur l'écran client en veille.
 * store_id NULL → campagne nationale (tous magasins). terminal_ids NULL/[] →
 * toutes les caisses ; sinon liste des terminalId ciblés. priority départage
 * plusieurs campagnes actives (la plus haute gagne, magasin > national).
 *
 * Règle TypeORM : type explicite sur chaque colonne nullable.
 */
@Entity('attract_campaigns')
@Index(['storeId', 'isActive'])
export class AttractCampaignEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id', type: 'uuid', nullable: true })
  storeId: string | null;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'starts_at', type: 'timestamptz', nullable: true })
  startsAt: Date | null;

  @Column({ name: 'ends_at', type: 'timestamptz', nullable: true })
  endsAt: Date | null;

  @Column({ type: 'integer', default: 0 })
  priority: number;

  @Column({ name: 'terminal_ids', type: 'jsonb', nullable: true })
  terminalIds: string[] | null;

  @Column({ type: 'boolean', default: true })
  loop: boolean;

  @OneToMany(() => AttractMediaEntity, (m) => m.campaign)
  media?: AttractMediaEntity[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
