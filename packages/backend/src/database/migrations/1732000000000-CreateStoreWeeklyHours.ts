import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Schedule chantier, commit 1 — analytics.store_weekly_hours: per-weekday
 * opening hours as OWNER data (BackOffice-editable). Wall-clock LOCAL times in
 * the store's clock timezone (A1 datum). NON-fiscal: the Z business day is
 * untouched — only the cockpit threshold/beat consumers will read this (via the
 * schedule resolver, next commits).
 *
 * Convention: weekday 0–6 = JS getDay() (0 = dimanche … 6 = samedi).
 * store_id NULL = network default (same pattern as analytics.store_clock);
 * a per-store override is a full 7-row set for that store.
 *
 * Seed (network default): 7 days OPEN, open 09:00 (ratified example default),
 * close carried from the A1 clock datum's close_hour (20 → '20:00') — the close
 * threshold value is CARRIED, not re-invented. No invented closed day: closing a
 * weekday (e.g. dimanche) is the owner's click in the BackOffice grid.
 *
 * ADDITIVE here: store_clock.close_hour still exists and is still the consumers'
 * source until commit 3 switches them to the resolver and DROPS the column
 * (one source per datum — replace, never parallel two living sources).
 */
export class CreateStoreWeeklyHours1732000000000 implements MigrationInterface {
  name = 'CreateStoreWeeklyHours1732000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS analytics.store_weekly_hours (
        id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        store_id     uuid,
        weekday      integer NOT NULL CHECK (weekday BETWEEN 0 AND 6),
        open_local   time,
        close_local  time,
        is_closed    boolean NOT NULL DEFAULT false,
        is_active    boolean NOT NULL DEFAULT true,
        updated_at   timestamptz NOT NULL DEFAULT now()
      )
    `);
    // NULLs are distinct in a plain unique index → partial pair (default vs per-store)
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_weekly_hours_default_weekday ON analytics.store_weekly_hours(weekday) WHERE store_id IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_weekly_hours_store_weekday ON analytics.store_weekly_hours(store_id, weekday) WHERE store_id IS NOT NULL`,
    );

    // Seed the network default from the LIVING close datum (store_clock.close_hour).
    const [clock] = await queryRunner.query(
      `SELECT close_hour FROM analytics.store_clock WHERE store_id IS NULL AND is_active = true LIMIT 1`,
    );
    const close = `${String(clock?.close_hour ?? 20).padStart(2, '0')}:00`;
    for (let weekday = 0; weekday <= 6; weekday++) {
      await queryRunner.query(
        `INSERT INTO analytics.store_weekly_hours (store_id, weekday, open_local, close_local, is_closed)
         VALUES (NULL, $1, '09:00', $2, false)`,
        [weekday, close],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS analytics.store_weekly_hours`);
  }
}
