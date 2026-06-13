import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A1 RATIFIED — the store timezone is a FACT: B43 (Grand Littoral, Marseille) =
 * Europe/Paris. The store_clock datum's hours are now interpreted as LOCAL
 * wall-clock in the row's IANA timezone (DST absorbed) — end of the UTC stand-in.
 *
 * Re-seed of the network default row:
 *  - timezone: Etc/UTC → Europe/Paris
 *  - brief_beat_hours: [10, 15] (UTC approximations) → [12, 17] (the ratified
 *    local beats: 12h / 17h)
 *  - close_hour: 20, value carried over — its MEANING upgrades from "20h UTC
 *    (≈22h Paris été)" to "20h LOCAL" (typical mall closing). Flagged in the
 *    batch report; per-store override remains one UPDATE (owner data).
 *
 * Consumers upgrade from the single datum (beats, store_closed_late, cockpit
 * business day) — never a parallel TZ config. Reversible.
 */
export class StoreClockLocalTime1730000000000 implements MigrationInterface {
  name = 'StoreClockLocalTime1730000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE analytics.store_clock
      SET timezone = 'Europe/Paris', brief_beat_hours = '[12, 17]', close_hour = 20
      WHERE store_id IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE analytics.store_clock
      SET timezone = 'Etc/UTC', brief_beat_hours = '[10, 15]', close_hour = 20
      WHERE store_id IS NULL
    `);
  }
}
