/**
 * Cycle R — validation PURE des lignes d'import catalogue.
 * Aucune I/O : la résolution DB (EAN existants, noms normalisés existants,
 * fournisseurs du magasin) est injectée par le service sous forme de sets/maps.
 *
 * Règles par ligne :
 *  - name, ean, priceMinorUnits requis ; prix entier ≥ 0 (centimes) ;
 *  - stockQuantity optionnel (entier ≥ 0, défaut 0) ;
 *  - EAN dupliqué DANS LE FICHIER → toutes les occurrences après la première en erreur ;
 *  - nom normalisé dupliqué DANS LE FICHIER → idem ;
 *  - EAN déjà présent dans le magasin → erreur ;
 *  - nom normalisé déjà présent dans le magasin → erreur (POS-066) ;
 *  - supplierName inconnu dans le magasin → erreur (pas de création implicite
 *    de fournisseur : l'import ne doit pas polluer le référentiel).
 */
import { normalizeName } from './name-normalize';

export interface ImportRow {
  name?: unknown;
  ean?: unknown;
  priceMinorUnits?: unknown;
  stockQuantity?: unknown;
  category?: unknown;
  brand?: unknown;
  variantLabel?: unknown;
  supplierName?: unknown;
}

export interface ValidImportRow {
  line: number; // 1-based, ordre du fichier
  name: string;
  ean: string;
  priceMinorUnits: number;
  stockQuantity: number;
  category: string | null;
  brand: string | null;
  variantLabel: string | null;
  supplierId: string | null;
}

export interface ImportRowError {
  line: number;
  ean: string | null;
  reason: string;
}

export interface ImportValidationContext {
  /** EAN déjà présents dans le magasin. */
  existingEans: ReadonlySet<string>;
  /** Noms normalisés déjà présents dans le magasin. */
  existingNormalizedNames: ReadonlySet<string>;
  /** nom fournisseur (trim, lowercase) → id, fournisseurs ACTIFS du magasin. */
  suppliersByName: ReadonlyMap<string, string>;
}

export interface ImportValidationResult {
  valid: ValidImportRow[];
  errors: ImportRowError[];
}

const asTrimmedString = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
};

const asNonNegativeInt = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : typeof v === 'number' ? v : NaN;
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
};

export function validateImportRows(
  rows: ImportRow[],
  ctx: ImportValidationContext,
): ImportValidationResult {
  const valid: ValidImportRow[] = [];
  const errors: ImportRowError[] = [];
  const seenEans = new Set<string>();
  const seenNames = new Set<string>();

  rows.forEach((row, idx) => {
    const line = idx + 1;
    const name = asTrimmedString(row.name);
    const ean = asTrimmedString(row.ean);
    const price = asNonNegativeInt(row.priceMinorUnits);

    if (!name) return void errors.push({ line, ean, reason: 'nom manquant' });
    if (!ean) return void errors.push({ line, ean: null, reason: 'EAN manquant' });
    if (price === null) {
      return void errors.push({ line, ean, reason: 'priceMinorUnits invalide (entier ≥ 0, en centimes)' });
    }

    const stock = row.stockQuantity === undefined || row.stockQuantity === null || row.stockQuantity === ''
      ? 0
      : asNonNegativeInt(row.stockQuantity);
    if (stock === null) return void errors.push({ line, ean, reason: 'stockQuantity invalide (entier ≥ 0)' });

    if (seenEans.has(ean)) return void errors.push({ line, ean, reason: 'EAN dupliqué dans le fichier' });
    const normalized = normalizeName(name);
    if (seenNames.has(normalized)) {
      return void errors.push({ line, ean, reason: 'nom équivalent dupliqué dans le fichier' });
    }
    if (ctx.existingEans.has(ean)) {
      return void errors.push({ line, ean, reason: 'EAN déjà présent dans le magasin' });
    }
    if (ctx.existingNormalizedNames.has(normalized)) {
      return void errors.push({ line, ean, reason: 'un produit au nom équivalent existe déjà dans le magasin' });
    }

    let supplierId: string | null = null;
    const supplierName = asTrimmedString(row.supplierName);
    if (supplierName) {
      const found = ctx.suppliersByName.get(supplierName.toLowerCase());
      if (!found) {
        return void errors.push({
          line, ean,
          reason: `fournisseur inconnu dans ce magasin : « ${supplierName} » (créez-le d'abord)`,
        });
      }
      supplierId = found;
    }

    seenEans.add(ean);
    seenNames.add(normalized);
    valid.push({
      line,
      name,
      ean,
      priceMinorUnits: price,
      stockQuantity: stock,
      category: asTrimmedString(row.category),
      brand: asTrimmedString(row.brand),
      variantLabel: asTrimmedString(row.variantLabel),
      supplierId,
    });
  });

  return { valid, errors };
}
