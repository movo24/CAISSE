import { Injectable } from '@nestjs/common';
import { ProductEntity } from '../../database/entities/product.entity';
import {
  AirtableRiskLevel,
} from '../../database/entities/airtable-operation.entity';

// ── Airtable field names (Products table) ────────────────────────────────────
// These constants are the single source of truth for field mapping.
// If you rename a column in Airtable, update it here only.
export const AT_FIELD = {
  // Read-only export fields (POS → Airtable)
  POS_ID: 'POS_ID',
  EAN: 'Code EAN',
  NAME: 'Nom',
  DESCRIPTION: 'Description',
  PRICE_CENTS: 'Prix (centimes)',
  COST_CENTS: 'Coût (centimes)',
  IMAGE_URL: 'Image URL',
  STOCK: 'Stock',
  IS_ACTIVE: 'Actif',
  STORE_ID: 'Magasin ID',
  UPDATED_AT: 'Dernière MAJ POS',
  // Proposal-only fields (Airtable → POS as pending operations)
  PUBLIC_NAME: 'Nom public',
  SEO_TITLE: 'SEO Titre',
  SEO_DESCRIPTION: 'SEO Description',
  MARKETING_TAGS: 'Tags marketing',
  COMMENT: 'Commentaire',
  VALIDATION_STATUS: 'Statut validation',
} as const;

export interface AirtableProductExportFields {
  [AT_FIELD.POS_ID]: string;
  [AT_FIELD.EAN]: string;
  [AT_FIELD.NAME]: string;
  [AT_FIELD.DESCRIPTION]: string;
  [AT_FIELD.PRICE_CENTS]: number;
  [AT_FIELD.COST_CENTS]: number | null;
  [AT_FIELD.IMAGE_URL]: string;
  [AT_FIELD.STOCK]: number;
  [AT_FIELD.IS_ACTIVE]: boolean;
  [AT_FIELD.STORE_ID]: string;
  [AT_FIELD.UPDATED_AT]: string;
}

export interface AirtableProductImportFields {
  [AT_FIELD.POS_ID]?: string;
  [AT_FIELD.PUBLIC_NAME]?: string;
  [AT_FIELD.SEO_TITLE]?: string;
  [AT_FIELD.SEO_DESCRIPTION]?: string;
  [AT_FIELD.MARKETING_TAGS]?: string;
  [AT_FIELD.COMMENT]?: string;
  [AT_FIELD.VALIDATION_STATUS]?: string;
  // Financial / stock fields that may be edited in Airtable (risk=high)
  [AT_FIELD.PRICE_CENTS]?: number;
  [AT_FIELD.STOCK]?: number;
  [AT_FIELD.IS_ACTIVE]?: boolean;
}

export interface ProposedOperation {
  field: string;
  proposedValue: unknown;
  currentValue: unknown | null;
  riskLevel: AirtableRiskLevel;
}

@Injectable()
export class AirtableOpsMapper {
  /**
   * Maps a POS ProductEntity to the set of fields that should be written to
   * the Airtable Products table (export direction).
   */
  productToAirtable(product: ProductEntity): AirtableProductExportFields {
    return {
      [AT_FIELD.POS_ID]: product.id,
      [AT_FIELD.EAN]: product.ean,
      [AT_FIELD.NAME]: product.name,
      [AT_FIELD.DESCRIPTION]: product.description ?? '',
      [AT_FIELD.PRICE_CENTS]: product.priceMinorUnits,
      [AT_FIELD.COST_CENTS]: product.costMinorUnits ?? null,
      [AT_FIELD.IMAGE_URL]: product.imageUrl ?? '',
      [AT_FIELD.STOCK]: product.stockQuantity,
      [AT_FIELD.IS_ACTIVE]: product.isActive,
      [AT_FIELD.STORE_ID]: product.storeId,
      [AT_FIELD.UPDATED_AT]: product.updatedAt.toISOString(),
    };
  }

  /**
   * Given Airtable import fields, produces a list of ProposedOperation objects
   * ready to be persisted as AirtableOperationEntity rows.
   *
   * IMPORTANT — price and stock changes are always high-risk and MUST NOT be
   * auto-applied under any circumstances.
   */
  airtableToProductOperations(
    fields: AirtableProductImportFields,
    product: ProductEntity,
  ): ProposedOperation[] {
    const ops: ProposedOperation[] = [];

    const push = (
      field: string,
      proposedValue: unknown,
      currentValue: unknown | null,
      riskLevel: AirtableRiskLevel,
    ) => {
      // Skip if the proposed value equals the current value
      if (JSON.stringify(proposedValue) === JSON.stringify(currentValue)) return;
      ops.push({ field, proposedValue, currentValue, riskLevel });
    };

    // ── Metadata / copy fields (low risk) ────────────────────────────────
    if (fields[AT_FIELD.PUBLIC_NAME] !== undefined) {
      push(AT_FIELD.PUBLIC_NAME, fields[AT_FIELD.PUBLIC_NAME], null, 'low');
    }
    if (fields[AT_FIELD.SEO_TITLE] !== undefined) {
      push(AT_FIELD.SEO_TITLE, fields[AT_FIELD.SEO_TITLE], null, 'low');
    }
    if (fields[AT_FIELD.SEO_DESCRIPTION] !== undefined) {
      push(AT_FIELD.SEO_DESCRIPTION, fields[AT_FIELD.SEO_DESCRIPTION], null, 'low');
    }
    if (fields[AT_FIELD.MARKETING_TAGS] !== undefined) {
      push(AT_FIELD.MARKETING_TAGS, fields[AT_FIELD.MARKETING_TAGS], null, 'low');
    }
    if (fields[AT_FIELD.COMMENT] !== undefined) {
      push(AT_FIELD.COMMENT, fields[AT_FIELD.COMMENT], null, 'low');
    }

    // ── Operational flags (medium risk) ──────────────────────────────────
    if (fields[AT_FIELD.VALIDATION_STATUS] !== undefined) {
      push(
        AT_FIELD.VALIDATION_STATUS,
        fields[AT_FIELD.VALIDATION_STATUS],
        null,
        'medium',
      );
    }
    if (fields[AT_FIELD.IS_ACTIVE] !== undefined) {
      push(
        'isActive',
        fields[AT_FIELD.IS_ACTIVE],
        product.isActive,
        'medium',
      );
    }

    // ── Financial / stock fields (HIGH risk — never auto-applied) ────────
    if (
      fields[AT_FIELD.PRICE_CENTS] !== undefined &&
      fields[AT_FIELD.PRICE_CENTS] !== product.priceMinorUnits
    ) {
      push(
        'priceMinorUnits',
        fields[AT_FIELD.PRICE_CENTS],
        product.priceMinorUnits,
        'high',
      );
    }
    if (
      fields[AT_FIELD.STOCK] !== undefined &&
      fields[AT_FIELD.STOCK] !== product.stockQuantity
    ) {
      push(
        'stockQuantity',
        fields[AT_FIELD.STOCK],
        product.stockQuantity,
        'high',
      );
    }

    return ops;
  }
}
