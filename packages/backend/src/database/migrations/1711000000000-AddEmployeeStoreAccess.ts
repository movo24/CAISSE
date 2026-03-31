import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the employee_store_access table for multi-store authorization.
 *
 * This table links employees to the stores they are authorized to access.
 * An employee can be assigned to 1 or multiple stores.
 * The POS login checks this table to verify store-level access.
 *
 * Source of truth: TimeWin24 manages employee assignments,
 * POS reads them for access control.
 */
export class AddEmployeeStoreAccess1711000000000 implements MigrationInterface {
  name = 'AddEmployeeStoreAccess1711000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS employee_store_access (
        id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
        employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        granted_at timestamp DEFAULT now() NOT NULL,
        UNIQUE(employee_id, store_id)
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_esa_employee ON employee_store_access(employee_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_esa_store ON employee_store_access(store_id)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS employee_store_access CASCADE`);
  }
}
