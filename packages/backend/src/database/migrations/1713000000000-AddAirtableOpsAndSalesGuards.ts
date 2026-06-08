import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds two read-only operational layers (PostgreSQL stays source of truth):
 *
 *   1. Airtable Ops Layer — visual ops cockpit. Nothing is applied to POS data
 *      automatically; every proposal becomes an `airtable_operations` row in
 *      `pending` status awaiting human review.
 *        - airtable_linked_records : local entity ↔ Airtable record mapping
 *        - airtable_sync_logs      : append-only sync batch log
 *        - airtable_operations     : pending change proposals + approval workflow
 *
 *   2. Sales Guards — anti-error engine. A SEPARATE audit table; the guard engine
 *      never writes to validated sales/tickets (NF525). Only `status` mutates.
 *        - sale_anomaly_logs       : detected anomalies + review workflow
 *
 * All tables use IF NOT EXISTS so the migration is safe to re-run.
 */
export class AddAirtableOpsAndSalesGuards1713000000000
  implements MigrationInterface
{
  name = 'AddAirtableOpsAndSalesGuards1713000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. airtable_linked_records ───────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS airtable_linked_records (
        id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
        local_entity_type varchar(50) NOT NULL,
        local_entity_id uuid NOT NULL,
        airtable_table_id varchar(64) NOT NULL,
        airtable_record_id varchar(64) NOT NULL,
        store_id uuid NOT NULL,
        last_synced_at timestamp,
        created_at timestamp DEFAULT now() NOT NULL,
        updated_at timestamp DEFAULT now() NOT NULL
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_airtable_linked_unique
        ON airtable_linked_records(local_entity_type, local_entity_id, airtable_table_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_airtable_linked_store
        ON airtable_linked_records(store_id, local_entity_type)
    `);

    // ── 2. airtable_sync_logs ────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS airtable_sync_logs (
        id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
        direction varchar(10) NOT NULL,
        entity_type varchar(50) NOT NULL,
        airtable_table_id varchar(64) NOT NULL,
        store_id uuid,
        records_processed int DEFAULT 0 NOT NULL,
        records_failed int DEFAULT 0 NOT NULL,
        duration_ms int DEFAULT 0 NOT NULL,
        status varchar(10) NOT NULL,
        error_message text,
        triggered_by varchar(20) NOT NULL,
        created_at timestamp DEFAULT now() NOT NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_airtable_sync_store ON airtable_sync_logs(store_id, created_at)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_airtable_sync_entity ON airtable_sync_logs(entity_type, direction)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_airtable_sync_status ON airtable_sync_logs(status)`);

    // ── 3. airtable_operations ───────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS airtable_operations (
        id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
        entity_type varchar(50) NOT NULL,
        entity_id uuid NOT NULL,
        store_id uuid NOT NULL,
        field varchar(100) NOT NULL,
        current_value jsonb,
        proposed_value jsonb NOT NULL,
        risk_level varchar(20) NOT NULL,
        status varchar(20) DEFAULT 'pending' NOT NULL,
        source_airtable_record_id varchar(64) NOT NULL,
        source_airtable_table_id varchar(64) NOT NULL,
        reviewed_by uuid,
        reviewed_at timestamp,
        applied_at timestamp,
        failure_reason text,
        created_at timestamp DEFAULT now() NOT NULL,
        updated_at timestamp DEFAULT now() NOT NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_airtable_ops_store_status ON airtable_operations(store_id, status)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_airtable_ops_entity ON airtable_operations(entity_type, entity_id, status)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_airtable_ops_status_created ON airtable_operations(status, created_at)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_airtable_ops_risk_status ON airtable_operations(risk_level, status)`);

    // ── 4. sale_anomaly_logs ─────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS sale_anomaly_logs (
        id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
        store_id uuid NOT NULL,
        seller_id uuid NOT NULL,
        sale_id uuid,
        product_id uuid,
        code varchar(50) NOT NULL,
        severity varchar(20) NOT NULL,
        blocking boolean DEFAULT false NOT NULL,
        manager_approval_required boolean DEFAULT false NOT NULL,
        message text NOT NULL,
        metadata jsonb,
        status varchar(20) DEFAULT 'detected' NOT NULL,
        reviewed_by uuid,
        reviewed_at timestamp,
        created_at timestamp DEFAULT now() NOT NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_sale_anomaly_store ON sale_anomaly_logs(store_id, created_at)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_sale_anomaly_seller ON sale_anomaly_logs(seller_id, created_at)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_sale_anomaly_code ON sale_anomaly_logs(code)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_sale_anomaly_status ON sale_anomaly_logs(status)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS sale_anomaly_logs CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS airtable_operations CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS airtable_sync_logs CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS airtable_linked_records CASCADE`);
  }
}
