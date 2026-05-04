import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds The Wesley Club loyalty system: loyalty cards, coupons,
 * visits, push devices, notifications, product highlights, idempotency.
 *
 * Source of truth rules:
 *   - POS Caisse remains MASTER of tickets and applied discounts
 *   - Mobile app is display-only (no client-side discount calculation)
 *   - All redemptions are transactional with row-level locks
 *
 * Anti-fraud:
 *   - QR tokens HMAC-signed, 60s TTL, server-rotated
 *   - Idempotency keys on /pos/loyalty/redeem (24h retention)
 *   - SELECT FOR UPDATE on coupons during redemption
 *   - All actions audited in audit_entries (existing hash chain)
 *
 * RGPD:
 *   - Soft-delete via customers.deleted_at
 *   - Anonymization cron 30 days after deletion
 */
export class AddLoyaltySystem1712000000000 implements MigrationInterface {
  name = 'AddLoyaltySystem1712000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Extensions to customers table ────────────────────────────
    await queryRunner.query(`
      ALTER TABLE customers
        ADD COLUMN IF NOT EXISTS password_hash varchar(100),
        ADD COLUMN IF NOT EXISTS preferred_store_id uuid,
        ADD COLUMN IF NOT EXISTS visit_count int DEFAULT 0,
        ADD COLUMN IF NOT EXISTS last_visit_at timestamp,
        ADD COLUMN IF NOT EXISTS deleted_at timestamp,
        ADD COLUMN IF NOT EXISTS anonymized_at timestamp
    `);

    // ── 1. loyalty_cards ─────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS loyalty_cards (
        id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
        customer_id uuid UNIQUE NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        public_code varchar(20) UNIQUE NOT NULL,
        qr_secret varchar(64) NOT NULL,
        status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
        issued_at timestamp DEFAULT now() NOT NULL,
        rotated_at timestamp,
        suspended_at timestamp,
        suspended_reason text
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_loyalty_cards_customer ON loyalty_cards(customer_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_loyalty_cards_status ON loyalty_cards(status)`);

    // ── 2. coupons ───────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS coupons (
        id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
        customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        type varchar(20) NOT NULL,
        discount_type varchar(20) DEFAULT 'PERCENT' NOT NULL,
        discount_value int NOT NULL,
        status varchar(20) DEFAULT 'AVAILABLE' NOT NULL,
        valid_from timestamp DEFAULT now() NOT NULL,
        valid_until timestamp,
        locked_at timestamp,
        locked_by_idempotency_key varchar(64),
        used_at timestamp,
        used_ticket_id uuid,
        used_store_id uuid,
        used_terminal_id uuid,
        visit_rank_when_emitted int,
        cycle_id uuid,
        created_at timestamp DEFAULT now() NOT NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_coupons_customer_status ON coupons(customer_id, status)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_coupons_status ON coupons(status)`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_coupons_idempotency ON coupons(locked_by_idempotency_key) WHERE locked_by_idempotency_key IS NOT NULL`);

    // ── 3. customer_visits ───────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS customer_visits (
        id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
        customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        terminal_id uuid,
        cashier_employee_id uuid,
        ticket_id uuid,
        purchase_amount_cents int,
        coupon_used_id uuid REFERENCES coupons(id) ON DELETE SET NULL,
        source varchar(20) DEFAULT 'POS_SCAN' NOT NULL,
        visited_at timestamp DEFAULT now() NOT NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_visits_customer_date ON customer_visits(customer_id, visited_at DESC)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_visits_store_date ON customer_visits(store_id, visited_at DESC)`);

    // ── 4. customer_devices ──────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS customer_devices (
        id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
        customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        device_token varchar(255) UNIQUE NOT NULL,
        platform varchar(10) DEFAULT 'IOS' NOT NULL,
        app_version varchar(20),
        notifications_enabled boolean DEFAULT true NOT NULL,
        last_seen_at timestamp,
        registered_at timestamp DEFAULT now() NOT NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_devices_customer ON customer_devices(customer_id)`);

    // ── 5. notification_preferences ──────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS notification_preferences (
        customer_id uuid PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
        new_products boolean DEFAULT true NOT NULL,
        discounts boolean DEFAULT true NOT NULL,
        limited_drops boolean DEFAULT true NOT NULL,
        store_events boolean DEFAULT true NOT NULL,
        loyalty_reminders boolean DEFAULT true NOT NULL,
        consent_given_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now() NOT NULL
      )
    `);

    // ── 6. notifications_log ─────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS notifications_log (
        id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
        customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,
        category varchar(30) NOT NULL,
        title varchar(200) NOT NULL,
        body text,
        payload jsonb,
        sent_at timestamp DEFAULT now() NOT NULL,
        delivered_at timestamp,
        opened_at timestamp,
        apns_message_id varchar(64)
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_notifs_customer_date ON notifications_log(customer_id, sent_at DESC)`);

    // ── 7. product_highlights ────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS product_highlights (
        id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
        product_id uuid REFERENCES products(id) ON DELETE SET NULL,
        name varchar(200) NOT NULL,
        description text,
        image_url text,
        category varchar(30),
        is_new boolean DEFAULT true NOT NULL,
        is_viral boolean DEFAULT false NOT NULL,
        active boolean DEFAULT true NOT NULL,
        starts_at timestamp,
        ends_at timestamp,
        created_at timestamp DEFAULT now() NOT NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_highlights_active ON product_highlights(active, created_at DESC)`);

    // ── 8. product_store_availability ────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS product_store_availability (
        product_highlight_id uuid NOT NULL REFERENCES product_highlights(id) ON DELETE CASCADE,
        store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        status varchar(20) DEFAULT 'AVAILABLE' NOT NULL,
        updated_at timestamp DEFAULT now() NOT NULL,
        PRIMARY KEY (product_highlight_id, store_id)
      )
    `);

    // ── 9. loyalty_reward_cycles ─────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS loyalty_reward_cycles (
        id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
        store_id uuid REFERENCES stores(id) ON DELETE CASCADE,
        rank int NOT NULL,
        discount_percent int NOT NULL,
        active boolean DEFAULT true NOT NULL,
        created_at timestamp DEFAULT now() NOT NULL
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_cycles_unique ON loyalty_reward_cycles(COALESCE(store_id::text, ''), rank) WHERE active = true`);

    // Seed default cycle: 5%, 5%, 10%, 5%
    await queryRunner.query(`
      INSERT INTO loyalty_reward_cycles (store_id, rank, discount_percent)
      VALUES (NULL, 1, 5), (NULL, 2, 5), (NULL, 3, 10), (NULL, 4, 5)
      ON CONFLICT DO NOTHING
    `);

    // ── 10. idempotency_keys ─────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS idempotency_keys (
        key varchar(64) PRIMARY KEY,
        endpoint varchar(100) NOT NULL,
        customer_id uuid,
        response_status int,
        response_body jsonb,
        created_at timestamp DEFAULT now() NOT NULL,
        expires_at timestamp DEFAULT (now() + interval '24 hours') NOT NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys(expires_at)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS idempotency_keys CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS loyalty_reward_cycles CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS product_store_availability CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS product_highlights CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS notifications_log CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS notification_preferences CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS customer_devices CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS customer_visits CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS coupons CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS loyalty_cards CASCADE`);
    await queryRunner.query(`
      ALTER TABLE customers
        DROP COLUMN IF EXISTS password_hash,
        DROP COLUMN IF EXISTS preferred_store_id,
        DROP COLUMN IF EXISTS visit_count,
        DROP COLUMN IF EXISTS last_visit_at,
        DROP COLUMN IF EXISTS deleted_at,
        DROP COLUMN IF EXISTS anonymized_at
    `);
  }
}
