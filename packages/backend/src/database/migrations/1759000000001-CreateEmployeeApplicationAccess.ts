import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Table `employee_application_access` : accès applicatif de pilotage (dimension séparée
 * du rôle POS cashier/manager/admin, qui reste inchangé).
 *
 * Une ligne par employé (index unique). Porte l'interrupteur d'accès, le rôle applicatif,
 * la fenêtre de validité, la suspension et la traçabilité de création.
 *
 * 100 % ADDITIVE (nouvelle table) et réversible (DROP). N'altère ni ventes, ni paiements,
 * ni stock, ni la chaîne de hash fiscale.
 */
export class CreateEmployeeApplicationAccess1759000000001 implements MigrationInterface {
  name = 'CreateEmployeeApplicationAccess1759000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS employee_application_access (
        id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
        employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        application_enabled boolean NOT NULL DEFAULT true,
        application_role varchar(40) NOT NULL,
        permission_level int NOT NULL DEFAULT 0,
        primary_store_id uuid,
        valid_from timestamp,
        valid_until timestamp,
        suspended_at timestamp,
        suspended_by uuid,
        created_by uuid,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_eaa_employee ON employee_application_access(employee_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS employee_application_access CASCADE`);
  }
}
