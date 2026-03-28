import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial schema migration — creates ALL tables from scratch.
 *
 * This migration must be the FIRST to run on a fresh database.
 * It uses IF NOT EXISTS to be idempotent (safe to re-run on existing DB).
 *
 * Generated from production schema dump on 2026-03-28.
 */
export class InitialSchema1700000000000 implements MigrationInterface {
  name = 'InitialSchema1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Extensions
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // ── Core tables ──

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS stores (
        id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
        organization_id uuid,
        unit_id uuid,
        store_code varchar UNIQUE,
        name varchar NOT NULL,
        address varchar,
        postal_code varchar,
        city varchar,
        phone varchar,
        email varchar,
        currency_code varchar DEFAULT 'EUR' NOT NULL,
        timezone varchar DEFAULT 'Europe/Paris' NOT NULL,
        tax_id varchar,
        siret varchar,
        siren varchar,
        naf varchar,
        tva_intracom varchar,
        rcs varchar,
        capital_social varchar,
        forme_juridique varchar,
        software_name varchar DEFAULT 'CAISSE POS',
        software_version varchar DEFAULT '1.0.0',
        nif_caisse varchar,
        header_message varchar,
        footer_message varchar,
        surface_m2 numeric,
        monthly_objective_minor_units integer DEFAULT 0,
        include_in_network boolean DEFAULT true NOT NULL,
        is_active boolean DEFAULT true NOT NULL,
        is_archived boolean DEFAULT false NOT NULL,
        created_at timestamp DEFAULT now() NOT NULL,
        updated_at timestamp DEFAULT now() NOT NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS employees (
        id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
        store_id uuid NOT NULL REFERENCES stores(id),
        first_name varchar NOT NULL,
        last_name varchar NOT NULL,
        email varchar NOT NULL,
        pin_hash varchar NOT NULL,
        qr_code varchar NOT NULL,
        role varchar DEFAULT 'cashier' NOT NULL,
        max_discount_percent numeric DEFAULT 5 NOT NULL,
        is_active boolean DEFAULT true NOT NULL,
        created_at timestamp DEFAULT now() NOT NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS products (
        id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
        ean varchar NOT NULL,
        barcode_source varchar(20) DEFAULT 'imported',
        name varchar NOT NULL,
        description varchar,
        category_id varchar,
        unit_type varchar DEFAULT 'unit' NOT NULL,
        price_minor_units integer NOT NULL,
        old_price_minor_units integer,
        currency_code varchar DEFAULT 'EUR' NOT NULL,
        cost_minor_units integer,
        tax_rate numeric DEFAULT 20 NOT NULL,
        image_url text,
        stock_quantity integer DEFAULT 0 NOT NULL,
        stock_alert_threshold integer DEFAULT 10 NOT NULL,
        stock_critical_threshold integer DEFAULT 5 NOT NULL,
        is_active boolean DEFAULT true NOT NULL,
        store_id uuid NOT NULL REFERENCES stores(id),
        created_at timestamp DEFAULT now() NOT NULL,
        updated_at timestamp DEFAULT now() NOT NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS sales (
        id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
        store_id varchar NOT NULL,
        employee_id varchar NOT NULL,
        employee_name_snapshot varchar,
        employee_role_snapshot varchar,
        employee_max_discount_snapshot numeric,
        customer_id varchar,
        status varchar DEFAULT 'pending' NOT NULL,
        subtotal_minor_units integer DEFAULT 0 NOT NULL,
        discount_total_minor_units integer DEFAULT 0 NOT NULL,
        tax_total_minor_units integer DEFAULT 0 NOT NULL,
        total_minor_units integer DEFAULT 0 NOT NULL,
        currency_code varchar DEFAULT 'EUR' NOT NULL,
        ticket_number varchar NOT NULL,
        hash_chain_prev varchar,
        hash_chain_current varchar,
        created_at timestamp DEFAULT now() NOT NULL,
        completed_at timestamp
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS sale_line_items (
        id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
        sale_id uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
        product_id varchar NOT NULL,
        product_name varchar NOT NULL,
        ean varchar NOT NULL,
        quantity integer NOT NULL,
        unit_price_minor_units integer NOT NULL,
        discount_minor_units integer DEFAULT 0 NOT NULL,
        promo_id varchar,
        tax_rate numeric DEFAULT 20 NOT NULL,
        line_total_minor_units integer NOT NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS sale_payments (
        id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
        sale_id uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
        method varchar NOT NULL,
        amount_minor_units integer NOT NULL,
        currency_code varchar DEFAULT 'EUR' NOT NULL,
        reference varchar,
        stripe_payment_intent_id varchar,
        stripe_reader_id varchar,
        terminal_id uuid
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
        first_name varchar NOT NULL,
        last_name varchar NOT NULL,
        phone varchar,
        email varchar,
        qr_code varchar NOT NULL,
        loyalty_points integer DEFAULT 0 NOT NULL,
        is_first_purchase boolean DEFAULT true NOT NULL,
        is_verified boolean DEFAULT false NOT NULL,
        store_id varchar NOT NULL,
        created_at timestamp DEFAULT now() NOT NULL,
        updated_at timestamp DEFAULT now() NOT NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS audit_entries (
        id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
        store_id varchar NOT NULL,
        employee_id varchar NOT NULL,
        action varchar NOT NULL,
        entity_type varchar NOT NULL,
        entity_id varchar NOT NULL,
        details jsonb DEFAULT '{}' NOT NULL,
        previous_hash varchar NOT NULL,
        current_hash varchar NOT NULL,
        "timestamp" timestamp DEFAULT now() NOT NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS z_reports (
        id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
        store_id varchar NOT NULL,
        date varchar NOT NULL,
        employee_id varchar NOT NULL,
        total_revenue_minor_units integer DEFAULT 0,
        total_tax_minor_units integer DEFAULT 0,
        currency_code varchar DEFAULT 'EUR',
        cash_total_minor_units integer DEFAULT 0,
        card_total_minor_units integer DEFAULT 0,
        transaction_count integer DEFAULT 0,
        average_basket_minor_units integer DEFAULT 0,
        top_products jsonb DEFAULT '[]',
        void_count integer DEFAULT 0,
        discount_total_minor_units integer DEFAULT 0,
        peak_hours jsonb DEFAULT '[]',
        created_at timestamp DEFAULT now() NOT NULL,
        UNIQUE(store_id, date)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS promo_rules (
        id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
        name varchar NOT NULL,
        type varchar NOT NULL,
        store_id varchar NOT NULL,
        buy_quantity integer,
        discount_percent numeric,
        discount_fixed_minor_units integer,
        applicable_product_ids jsonb DEFAULT '[]' NOT NULL,
        applicable_category_ids jsonb DEFAULT '[]' NOT NULL,
        start_date timestamp NOT NULL,
        end_date timestamp,
        is_active boolean DEFAULT true NOT NULL,
        created_at timestamp DEFAULT now() NOT NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS organizations (
        id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
        name varchar NOT NULL,
        legal_name varchar,
        siret varchar,
        siren varchar,
        tva_intracom varchar,
        country varchar DEFAULT 'FR' NOT NULL,
        currency_code varchar DEFAULT 'EUR' NOT NULL,
        logo_url text,
        email varchar,
        phone varchar,
        address varchar,
        city varchar,
        postal_code varchar,
        is_active boolean DEFAULT true NOT NULL,
        notes text,
        created_at timestamp DEFAULT now() NOT NULL,
        updated_at timestamp DEFAULT now() NOT NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS units (
        id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
        organization_id uuid REFERENCES organizations(id),
        name varchar NOT NULL,
        code varchar,
        description text,
        is_active boolean DEFAULT true NOT NULL,
        created_at timestamp DEFAULT now() NOT NULL,
        updated_at timestamp DEFAULT now() NOT NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
        store_id uuid NOT NULL REFERENCES stores(id) UNIQUE,
        plan varchar DEFAULT 'free' NOT NULL,
        billing_cycle varchar DEFAULT 'monthly',
        status varchar DEFAULT 'active' NOT NULL,
        stripe_customer_id varchar,
        stripe_subscription_id varchar,
        trial_ends_at timestamp,
        current_period_end timestamp,
        created_at timestamp DEFAULT now() NOT NULL,
        updated_at timestamp DEFAULT now() NOT NULL
      )
    `);

    // ── Supporting tables ──

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS product_categories (
        id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
        name varchar NOT NULL,
        parent_id varchar,
        store_id varchar NOT NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS price_history (
        id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
        product_id varchar NOT NULL,
        old_price_minor_units integer NOT NULL,
        new_price_minor_units integer NOT NULL,
        changed_by varchar NOT NULL,
        reason varchar,
        changed_at timestamp DEFAULT now() NOT NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS fx_rates (
        id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
        base_currency varchar NOT NULL,
        quote_currency varchar NOT NULL,
        rate numeric(12,6) NOT NULL,
        source varchar DEFAULT 'manual' NOT NULL,
        "timestamp" timestamp DEFAULT now() NOT NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS connected_apps (
        id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
        organization_id uuid NOT NULL,
        name varchar NOT NULL,
        type varchar DEFAULT 'internal' NOT NULL,
        status varchar DEFAULT 'active' NOT NULL,
        app_url varchar,
        api_url varchar,
        webhook_url varchar,
        api_key varchar,
        icon_url text,
        description text,
        unit_ids jsonb DEFAULT '[]' NOT NULL,
        store_ids jsonb DEFAULT '[]' NOT NULL,
        last_sync_at timestamp,
        last_error text,
        is_active boolean DEFAULT true NOT NULL,
        created_at timestamp DEFAULT now() NOT NULL,
        updated_at timestamp DEFAULT now() NOT NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS inventory_scans (
        id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
        store_id uuid NOT NULL,
        store_code varchar NOT NULL,
        employee_id varchar NOT NULL,
        barcode varchar NOT NULL,
        product_id uuid,
        product_name varchar,
        quantity integer DEFAULT 1 NOT NULL,
        scan_type varchar DEFAULT 'inventory' NOT NULL,
        status varchar DEFAULT 'pending' NOT NULL,
        notes varchar,
        session_id uuid,
        created_at timestamp DEFAULT now() NOT NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS jackpot_configs (
        id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
        store_id varchar NOT NULL,
        mega_jackpot_quota_per_day integer DEFAULT 1,
        small_win_quota_per_day integer DEFAULT 3,
        density_threshold_for_mega integer DEFAULT 8,
        mega_probability_percent numeric(5,2) DEFAULT 5,
        small_win_probability_percent numeric(5,2) DEFAULT 15,
        roulette_video_url varchar,
        win_video_url varchar,
        thanks_video_url varchar,
        win_audio_url varchar,
        thanks_audio_url varchar,
        open_weather_api_key varchar,
        open_weather_city varchar,
        is_active boolean DEFAULT true NOT NULL,
        created_at timestamp DEFAULT now() NOT NULL,
        updated_at timestamp DEFAULT now() NOT NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS jackpot_wins (
        id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
        store_id varchar NOT NULL,
        sale_id varchar NOT NULL,
        type varchar(20) NOT NULL,
        live_count_at_roll integer DEFAULT 0,
        created_at timestamp DEFAULT now() NOT NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS pos_sessions (
        id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
        store_id varchar NOT NULL,
        employee_id varchar NOT NULL,
        employee_name varchar NOT NULL,
        employee_role varchar NOT NULL,
        max_discount numeric DEFAULT 0 NOT NULL,
        permissions jsonb DEFAULT '{}' NOT NULL,
        timewin_session_token varchar,
        is_active boolean DEFAULT true NOT NULL,
        opened_at timestamp DEFAULT now() NOT NULL,
        closed_at timestamp,
        offline_mode boolean DEFAULT false NOT NULL
      )
    `);

    // ── Indexes ──
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_sales_store_id ON sales(store_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_sales_store_created ON sales(store_id, created_at)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_sales_store_status ON sales(store_id, status, completed_at)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_products_store ON products(store_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_products_ean_store ON products(ean, store_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_employees_store ON employees(store_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_audit_store ON audit_entries(store_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_line_items_sale ON sale_line_items(sale_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_payments_sale ON sale_payments(sale_id)`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_store ON sales(ticket_number, store_id)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop in reverse dependency order
    const tables = [
      'jackpot_wins', 'jackpot_configs', 'pos_sessions', 'inventory_scans',
      'connected_apps', 'fx_rates', 'price_history', 'product_categories',
      'subscriptions', 'units', 'organizations', 'promo_rules', 'z_reports',
      'audit_entries', 'customers', 'sale_payments', 'sale_line_items', 'sales',
      'products', 'employees', 'stores',
    ];
    for (const table of tables) {
      await queryRunner.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
    }
  }
}
