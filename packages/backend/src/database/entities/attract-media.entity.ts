import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { AttractCampaignEntity } from './attract-campaign.entity';

export type AttractMediaType = 'video' | 'image';

/**
 * Élément d'une playlist attract (vidéo MP4/WebM ou image), ordonné par
 * `position`. `durationSeconds` cadence les images et plafonne éventuellement
 * une vidéo (NULL = durée native de la vidéo). Supprimé en cascade avec la
 * campagne.
 */
@Entity('attract_media')
@Index(['campaignId', 'position'])
export class AttractMediaEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'campaign_id', type: 'uuid' })
  campaignId: string;

  @ManyToOne(() => AttractCampaignEntity, (c) => c.media, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'campaign_id' })
  campaign?: AttractCampaignEntity;

  @Column({ type: 'integer', default: 0 })
  position: number;

  @Column({ type: 'varchar', length: 16 })
  type: AttractMediaType;

  @Column({ type: 'text' })
  url: string;

  @Column({ name: 'duration_seconds', type: 'integer', nullable: true })
  durationSeconds: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
