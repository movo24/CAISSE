import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * GO Product Packs — packs d'articles / produits composés.
 *
 * Additive, réversible, AUCUNE écriture sur les données existantes :
 *  - product_components : composition COURANTE d'un pack (parent facturé →
 *    composants inclus dans son prix). CHECKs SQL : quantité > 0, parent ≠
 *    composant, unicité (store, parent, composant).
 *  - sale_component_movements : snapshot FIGÉ par vente + traçabilité des
 *    mouvements composants (origine vente pack, session, employé). Append-only.
 *
 * Les deux tables restent HORS empreinte hash des ventes/avoirs (allowlists
 * inchangées, aucune ligne re-hashée) ; la restauration au retour est scellée
 * via le maillon fiscal_journal stock_restored existant (payload enrichi,
 * additif).
 */
export class CreateProductComponents1754000000000 implements MigrationInterface {
  name = 'CreateProductComponents1754000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS product_components (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        store_id uuid NOT NULL,
        parent_product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        component_product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        quantity_per_parent integer NOT NULL,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_product_components_qty CHECK (quantity_per_parent > 0),
        CONSTRAINT chk_product_components_not_self CHECK (parent_product_id <> component_product_id)
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_product_components_store_parent_component
        ON product_components (store_id, parent_product_id, component_product_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_product_components_parent ON product_components (parent_product_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_product_components_component ON product_components (component_product_id)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS sale_component_movements (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        store_id uuid NOT NULL,
        sale_id uuid NOT NULL,
        sale_line_item_id uuid NOT NULL,
        parent_product_id uuid NOT NULL,
        component_product_id uuid NOT NULL,
        quantity_per_parent integer NOT NULL,
        quantity_consumed integer NOT NULL,
        employee_id uuid,
        session_id uuid,
        terminal_id varchar,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_sale_component_movements_qty CHECK (quantity_consumed > 0 AND quantity_per_parent > 0)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_sale_component_movements_sale ON sale_component_movements (sale_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_sale_component_movements_line ON sale_component_movements (sale_line_item_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_sale_component_movements_store_component
        ON sale_component_movements (store_id, component_product_id, created_at)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_sale_component_movements_store_component`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_sale_component_movements_line`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_sale_component_movements_sale`);
    await queryRunner.query(`DROP TABLE IF EXISTS sale_component_movements`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_product_components_component`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_product_components_parent`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_product_components_store_parent_component`);
    await queryRunner.query(`DROP TABLE IF EXISTS product_components`);
  }
}
