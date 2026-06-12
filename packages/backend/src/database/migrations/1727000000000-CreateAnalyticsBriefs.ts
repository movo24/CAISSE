import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Étage 3 — analytics.briefs: the persisted daily narrative brief. Keyed
 * (scope_key, business_day), regenerated only when computed_at advances (the same
 * monotonic anchor as the alerts gate). Stores the findings (audit trail) next to
 * the provenance-verified text. Additive + reversible.
 */
export class CreateAnalyticsBriefs1727000000000 implements MigrationInterface {
  name = 'CreateAnalyticsBriefs1727000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS analytics.briefs (
        id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        scope_key     varchar(64) NOT NULL,
        business_day  date NOT NULL,
        computed_at   timestamptz NOT NULL,
        findings      jsonb NOT NULL,
        text          text NOT NULL,
        status        varchar NOT NULL,
        created_at    timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_briefs_scope_day ON analytics.briefs(scope_key, business_day)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS analytics.briefs`);
  }
}
