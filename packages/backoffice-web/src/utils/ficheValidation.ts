import { productCodeIssue, PRODUCT_CODE_ISSUE_MESSAGE } from './gtin';

/**
 * Validation client + mapping des erreurs serveur de la fiche produit
 * (ProductEditPage) — un problème = UN champ surligné avec un message
 * exploitable, l'onglet fautif ouvert, jamais un « Erreur de validation »
 * générique (incident création produit 2026-07-21).
 */

export type FicheTab =
  | 'general' | 'tarification' | 'stock' | 'fournisseurs' | 'images' | 'logistique';

/** Sous-ensemble du state `form` de ProductEditPage utilisé par la validation. */
export interface FicheFormShape {
  ean: string; name: string; description: string; categoryId: string;
  sku: string; brandId: string; supplierId: string;
  status: string; productType: string; unitType: string; imageUrl: string;
  bestBeforeDate: string; useByDate: string;
  priceTtc: string; cost: string; taxRate: string;
  stock: string; alertThreshold: string; criticalThreshold: string;
  shortName: string; internalRef: string; supplierRef: string;
  countryOfOrigin: string; leadTimeDays: string; minOrderQuantity: string;
  weightGrams: string; widthMm: string; heightMm: string; depthMm: string;
  volumeMl: string; unitsPerCarton: string;
  isSeasonal: boolean; seasonStartMonth: string; seasonEndMonth: string;
  minPrice: string; recommendedPrice: string; unitsPerPack: string;
  cartonsPerPallet: string; allergens: string; ingredients: string;
  lotNumber: string;
}

export type FicheErrors = Partial<Record<keyof FicheFormShape, string>>;

/** Champ → onglet + libellé humain, dans l'ordre visuel de la page. */
const FIELD_META: Array<[keyof FicheFormShape, FicheTab, string]> = [
  ['name', 'general', 'Nom du produit'],
  ['ean', 'general', 'Code EAN'],
  ['description', 'general', 'Désignation / description'],
  ['categoryId', 'general', 'Catégorie'],
  ['sku', 'general', 'SKU interne'],
  ['brandId', 'general', 'Marque'],
  ['unitType', 'general', 'Unité de vente'],
  ['status', 'general', 'Statut'],
  ['shortName', 'general', 'Nom court caisse'],
  ['internalRef', 'general', 'Référence interne'],
  ['productType', 'general', 'Type de produit'],
  ['cost', 'tarification', "Prix d'achat HT"],
  ['priceTtc', 'tarification', 'Prix de vente TTC'],
  ['taxRate', 'tarification', 'TVA'],
  ['minPrice', 'tarification', 'Prix minimum autorisé'],
  ['recommendedPrice', 'tarification', 'Prix conseillé'],
  ['stock', 'stock', 'Stock actuel'],
  ['alertThreshold', 'stock', "Seuil d'alerte"],
  ['criticalThreshold', 'stock', 'Seuil critique'],
  ['seasonStartMonth', 'stock', 'Début de saison'],
  ['seasonEndMonth', 'stock', 'Fin de saison'],
  ['supplierId', 'fournisseurs', 'Fournisseur'],
  ['supplierRef', 'fournisseurs', 'Référence fournisseur'],
  ['leadTimeDays', 'fournisseurs', 'Délai (jours)'],
  ['minOrderQuantity', 'fournisseurs', 'MOQ'],
  ['countryOfOrigin', 'fournisseurs', "Pays d'origine"],
  ['imageUrl', 'images', 'Image principale'],
  ['weightGrams', 'logistique', 'Poids'],
  ['widthMm', 'logistique', 'Largeur'],
  ['heightMm', 'logistique', 'Hauteur'],
  ['depthMm', 'logistique', 'Profondeur'],
  ['volumeMl', 'logistique', 'Volume'],
  ['unitsPerCarton', 'logistique', 'Unités / carton'],
  ['unitsPerPack', 'logistique', 'Unités / colis'],
  ['cartonsPerPallet', 'logistique', 'Cartons / palette'],
  ['allergens', 'logistique', 'Allergènes'],
  ['ingredients', 'logistique', 'Ingrédients'],
  ['bestBeforeDate', 'logistique', 'DDM'],
  ['useByDate', 'logistique', 'DLC'],
  ['lotNumber', 'logistique', 'Numéro de lot'],
];

const FIELD_ORDER = FIELD_META.map(([k]) => k);
const FIELD_TAB = Object.fromEntries(FIELD_META.map(([k, t]) => [k, t])) as Record<
  keyof FicheFormShape, FicheTab
>;
const FIELD_LABEL = Object.fromEntries(FIELD_META.map(([k, , l]) => [k, l])) as Record<
  keyof FicheFormShape, string
>;

export const tabOfField = (f: keyof FicheFormShape): FicheTab => FIELD_TAB[f] ?? 'general';
export const labelOfField = (f: keyof FicheFormShape): string => FIELD_LABEL[f] ?? f;

/** Champs d'un onglet, dans l'ordre visuel (assistant séquentiel). */
export function fieldsOfTab(tab: FicheTab): Array<keyof FicheFormShape> {
  return FIELD_META.filter(([, t]) => t === tab).map(([k]) => k);
}

/** Premier champ en erreur, dans l'ordre visuel onglet par onglet. */
export function firstErrorField(errors: FicheErrors): keyof FicheFormShape | null {
  for (const key of FIELD_ORDER) if (errors[key]) return key;
  const rest = Object.keys(errors) as Array<keyof FicheFormShape>;
  return rest.length ? rest[0] : null;
}

/** Bandeau : « Impossible d'enregistrer : N champ(s) doivent être corrigés ». */
export function errorSummary(errors: FicheErrors): string {
  const n = Object.keys(errors).length;
  return n === 1
    ? 'Impossible d’enregistrer : 1 champ doit être corrigé.'
    : `Impossible d’enregistrer : ${n} champs doivent être corrigés.`;
}

const num = (s: string): number | null => {
  const v = parseFloat((s || '').trim().replace(',', '.'));
  return Number.isFinite(v) ? v : null;
};
const isIntStr = (s: string): boolean => /^\d+$/.test((s || '').trim());

const requireMoney = (s: string): string | null => {
  if ((s || '').trim() === '') return null;
  const v = num(s);
  if (v === null) return 'Nombre attendu (ex. 4,50).';
  if (v < 0) return 'Le montant ne peut pas être négatif.';
  return null;
};
const requireInt = (s: string): string | null => {
  if ((s || '').trim() === '') return null;
  if (!isIntStr(s)) return 'Nombre entier ≥ 0 attendu.';
  return null;
};
const maxLen = (s: string, max: number): string | null =>
  (s || '').length > max ? `Maximum ${max} caractères.` : null;

/**
 * Validation complète côté client — reflète les règles du DTO serveur.
 * La catégorie est FACULTATIVE : « Aucune » n'est jamais bloquant.
 */
export function validateFiche(form: FicheFormShape, isEdit: boolean): FicheErrors {
  const errors: FicheErrors = {};
  const put = (k: keyof FicheFormShape, msg: string | null) => {
    if (msg && !errors[k]) errors[k] = msg;
  };

  if (!form.name.trim()) put('name', 'Le nom du produit est obligatoire.');
  else put('name', maxLen(form.name.trim(), 200));

  if (!isEdit) {
    const issue = productCodeIssue(form.ean);
    if (issue) put('ean', PRODUCT_CODE_ISSUE_MESSAGE[issue]);
  }

  if (form.priceTtc.trim() === '') {
    put('priceTtc', 'Le prix de vente TTC est obligatoire (ex. 4,50).');
  } else {
    const v = num(form.priceTtc);
    if (v === null) put('priceTtc', 'Prix de vente TTC invalide : nombre attendu (ex. 4,50).');
    else if (v < 0) put('priceTtc', 'Le prix de vente TTC ne peut pas être négatif.');
  }

  put('cost', requireMoney(form.cost));
  put('taxRate', requireMoney(form.taxRate));
  put('minPrice', requireMoney(form.minPrice));
  put('recommendedPrice', requireMoney(form.recommendedPrice));

  put('stock', requireInt(form.stock));
  put('alertThreshold', requireInt(form.alertThreshold));
  put('criticalThreshold', requireInt(form.criticalThreshold));
  put('leadTimeDays', requireInt(form.leadTimeDays));
  put('minOrderQuantity', requireInt(form.minOrderQuantity));
  put('weightGrams', requireInt(form.weightGrams));
  put('widthMm', requireInt(form.widthMm));
  put('heightMm', requireInt(form.heightMm));
  put('depthMm', requireInt(form.depthMm));
  put('volumeMl', requireInt(form.volumeMl));
  put('unitsPerCarton', requireInt(form.unitsPerCarton));
  put('unitsPerPack', requireInt(form.unitsPerPack));
  put('cartonsPerPallet', requireInt(form.cartonsPerPallet));

  if (form.isSeasonal) {
    for (const k of ['seasonStartMonth', 'seasonEndMonth'] as const) {
      const s = form[k].trim();
      if (s !== '' && (!isIntStr(s) || +s < 1 || +s > 12)) {
        put(k, 'Mois entre 1 et 12 attendu.');
      }
    }
  }

  put('shortName', maxLen(form.shortName, 120));
  put('sku', maxLen(form.sku.trim(), 100));
  put('internalRef', maxLen(form.internalRef.trim(), 100));
  put('supplierRef', maxLen(form.supplierRef.trim(), 100));
  put('countryOfOrigin', maxLen(form.countryOfOrigin.trim(), 80));
  put('description', maxLen(form.description.trim(), 1000));
  put('allergens', maxLen(form.allergens.trim(), 1000));
  put('ingredients', maxLen(form.ingredients.trim(), 2000));
  put('lotNumber', maxLen(form.lotNumber.trim(), 60));

  return errors;
}

// ── Mapping des erreurs SERVEUR vers les champs du formulaire ────────────────

/** Propriété DTO backend → clé du formulaire (identique sauf montants/stock). */
const BACKEND_TO_FORM: Record<string, keyof FicheFormShape> = {
  ean: 'ean', name: 'name', description: 'description', categoryId: 'categoryId',
  sku: 'sku', brandId: 'brandId', supplierId: 'supplierId',
  priceMinorUnits: 'priceTtc', costMinorUnits: 'cost', taxRate: 'taxRate',
  minPriceMinorUnits: 'minPrice', recommendedPriceMinorUnits: 'recommendedPrice',
  stockQuantity: 'stock', stockAlertThreshold: 'alertThreshold',
  stockCriticalThreshold: 'criticalThreshold',
  shortName: 'shortName', internalRef: 'internalRef', supplierRef: 'supplierRef',
  countryOfOrigin: 'countryOfOrigin', leadTimeDays: 'leadTimeDays',
  minOrderQuantity: 'minOrderQuantity', weightGrams: 'weightGrams',
  widthMm: 'widthMm', heightMm: 'heightMm', depthMm: 'depthMm',
  volumeMl: 'volumeMl', unitsPerCarton: 'unitsPerCarton',
  seasonStartMonth: 'seasonStartMonth', seasonEndMonth: 'seasonEndMonth',
  unitsPerPack: 'unitsPerPack', cartonsPerPallet: 'cartonsPerPallet',
  allergens: 'allergens', ingredients: 'ingredients', lotNumber: 'lotNumber',
  status: 'status', productType: 'productType', unitType: 'unitType',
  imageUrl: 'imageUrl', bestBeforeDate: 'bestBeforeDate', useByDate: 'useByDate',
};
const BACKEND_PROPS = Object.keys(BACKEND_TO_FORM);

/** Traduit un message de contrainte class-validator (anglais) en français. */
function translateConstraint(prop: string, raw: string): string {
  // Nos messages métier sont déjà en français et ne commencent pas par la propriété.
  const msg = raw.startsWith(`${prop} `) ? raw.slice(prop.length + 1) : raw;
  if (msg === raw && !/^must |^should /.test(msg)) return msg;

  let m: RegExpMatchArray | null;
  if (/^must be an integer number/.test(msg)) return 'Nombre entier attendu.';
  if (/^must be a number/.test(msg)) return 'Nombre attendu.';
  if ((m = msg.match(/^must not be less than (-?\d+)/))) return `Doit être supérieur ou égal à ${m[1]}.`;
  if ((m = msg.match(/^must not be greater than (-?\d+)/))) return `Doit être inférieur ou égal à ${m[1]}.`;
  if (/^should not be empty/.test(msg)) return 'Champ obligatoire.';
  if ((m = msg.match(/^must be shorter than or equal to (\d+) characters/))) return `Maximum ${m[1]} caractères.`;
  if (/^must be a UUID/.test(msg)) return 'Sélection invalide — choisissez une valeur dans la liste.';
  if ((m = msg.match(/^must be one of the following values: (.+)$/))) return `Valeur non autorisée (valeurs possibles : ${m[1]}).`;
  if (/^must be a string/.test(msg)) return 'Texte attendu.';
  if (/^must be a boolean/.test(msg)) return 'Valeur oui/non attendue.';
  return msg;
}

export interface MappedApiError {
  fieldErrors: FicheErrors;
  /** Message de bandeau (en plus des erreurs de champs), ou null. */
  banner: string | null;
  /** true si le serveur refuse des champs que cette interface envoie (versions désalignées). */
  incompatible: boolean;
}

/**
 * Transforme la réponse d'erreur API (axios `err.response.data`) en erreurs
 * par champ + bandeau. Ne perd JAMAIS d'information : ce qui n'est pas
 * mappable à un champ part dans le bandeau.
 */
export function mapApiError(data: any): MappedApiError {
  if (!data || typeof data !== 'object') {
    return {
      fieldErrors: {},
      banner: 'Enregistrement impossible : le serveur est injoignable. Vos saisies sont conservées — réessayez.',
      incompatible: false,
    };
  }

  if (data.code === 'PRODUCT_BARCODE_ALREADY_EXISTS') {
    const name = data.details?.existingProduct?.name;
    return {
      fieldErrors: { ean: name ? `Ce code-barres existe déjà (produit : ${name}).` : 'Ce code-barres existe déjà.' },
      banner: null,
      incompatible: false,
    };
  }
  if (data.code === 'PRODUCT_SKU_ALREADY_EXISTS') {
    const name = data.details?.existingProduct?.name;
    return {
      fieldErrors: { sku: name ? `Ce SKU existe déjà (produit : ${name}).` : 'Ce SKU existe déjà.' },
      banner: null,
      incompatible: false,
    };
  }

  if (data.code === 'VALIDATION_ERROR') {
    const fieldErrors: FicheErrors = {};
    const unknownProps: string[] = [];
    const unmapped: string[] = [];

    // Source structurée si le serveur la fournit (fields), sinon details (plat).
    const entries: Array<[string, string[]]> = data.fields
      ? Object.entries(data.fields as Record<string, string[]>)
      : parseDetails(Array.isArray(data.details) ? data.details : []);

    for (const [prop, messages] of entries) {
      if (messages.some((m) => m.includes('should not exist'))) {
        unknownProps.push(prop);
        continue;
      }
      const formKey = BACKEND_TO_FORM[prop];
      const text = messages.map((m) => translateConstraint(prop, m)).join(' ');
      if (formKey) {
        fieldErrors[formKey] = text;
      } else {
        unmapped.push(`${prop} : ${text}`);
      }
    }

    const bannerParts: string[] = [];
    if (unknownProps.length) {
      bannerParts.push(
        `Le serveur n’accepte pas certains champs de cette fiche (${unknownProps.join(', ')}) : ` +
          'les versions de l’interface et du serveur sont désalignées. ' +
          'Contactez l’administrateur pour mettre à jour le serveur — vos saisies sont conservées.',
      );
    }
    if (unmapped.length) bannerParts.push(unmapped.join(' · '));

    return {
      fieldErrors,
      banner: bannerParts.length ? bannerParts.join(' ') : null,
      incompatible: unknownProps.length > 0,
    };
  }

  return {
    fieldErrors: {},
    banner: typeof data.message === 'string' && data.message
      ? data.message
      : 'Enregistrement impossible. Vos saisies sont conservées — réessayez.',
    incompatible: false,
  };
}

/** Regroupe un tableau plat de messages class-validator par propriété. */
function parseDetails(details: string[]): Array<[string, string[]]> {
  const byProp = new Map<string, string[]>();
  const add = (prop: string, msg: string) => {
    byProp.set(prop, [...(byProp.get(prop) ?? []), msg]);
  };
  for (const raw of details) {
    if (typeof raw !== 'string') continue;
    const unknown = raw.match(/^property (\S+) should not exist$/);
    if (unknown) { add(unknown[1], raw); continue; }
    const prop = BACKEND_PROPS.find((p) => raw.startsWith(`${p} `));
    if (prop) add(prop, raw);
    else add(raw.split(' ')[0] ?? raw, raw);
  }
  return [...byProp.entries()];
}
