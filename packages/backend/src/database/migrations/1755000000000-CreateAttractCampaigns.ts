import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bloc 4 — Mode attract : gestion de contenu (campagnes + playlists).
 *
 * Additive, réversible, NON fiscale, AUCUNE écriture sur les données existantes.
 * Alimente l'écran client en veille (idle) avec des playlists vidéos/images
 * programmables : ordre, durée, dates de validité, campagnes nationales
 * (store_id NULL) vs par magasin, ciblage par caisse (terminal_ids).
 *
 *  - attract_campaigns : une campagne = une playlist ordonnée, avec fenêtre de
 *    diffusion et ciblage magasin/caisse. priority départage plusieurs
 *    campagnes actives simultanément.
 *  - attract_media : éléments ordonnés d'une campagne (vidéo MP4/WebM ou image),
 *    avec durée (pour les images / cap vidéo). ON DELETE CASCADE.
 */
export class CreateAttractCampaigns1755000000000 implements MigrationInterface {
  name = 'CreateAttractCampaigns1755000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS attract_campaigns (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        store_id uuid,
        name varchar(200) NOT NULL,
        is_active boolean NOT NULL DEFAULT true,
        starts_at timestamptz,
        ends_at timestamptz,
        priority integer NOT NULL DEFAULT 0,
        terminal_ids jsonb,
        loop boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_attract_campaigns_store_active
        ON attract_campaigns (store_id, is_active)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS attract_media (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        campaign_id uuid NOT NULL REFERENCES attract_campaigns(id) ON DELETE CASCADE,
        position integer NOT NULL DEFAULT 0,
        type varchar(16) NOT NULL,
        url text NOT NULL,
        duration_seconds integer,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_attract_media_type CHECK (type IN ('video', 'image')),
        CONSTRAINT chk_attract_media_position CHECK (position >= 0),
        CONSTRAINT chk_attract_media_duration CHECK (duration_seconds IS NULL OR duration_seconds >= 0)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_attract_media_campaign_position
        ON attract_media (campaign_id, position)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_attract_media_campaign_position`);
    await queryRunner.query(`DROP TABLE IF EXISTS attract_media`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_attract_campaigns_store_active`);
    await queryRunner.query(`DROP TABLE IF EXISTS attract_campaigns`);
  }
}
