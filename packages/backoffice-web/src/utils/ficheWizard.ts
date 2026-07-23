import {
  validateFiche, fieldsOfTab, type FicheErrors, type FicheFormShape, type FicheTab,
} from './ficheValidation';

/**
 * Assistant séquentiel de la fiche produit (P0 « fiche guidée + sync caisse »).
 *
 * Règles owner :
 *  - parcours ordonné, « Suivant » contrôle et verrouille l'étape ;
 *  - un champ obligatoire manquant → on reste sur l'étape, champ surligné ;
 *  - étapes conditionnelles : un pack exige ses composants, un produit simple
 *    n'en exige aucun ;
 *  - une étape sans donnée n'est JAMAIS ignorée silencieusement : soit elle a
 *    du contenu, soit l'utilisateur coche explicitement « Non applicable /
 *    Aucun » avant de continuer ;
 *  - validation finale uniquement après toutes les étapes → « Valider et
 *    publier en caisse ».
 *
 * Module pur (aucun React) — testé unitairement.
 */

export type WizardStep =
  | 'general' | 'tarification' | 'stock' | 'fournisseurs' | 'packs'
  | 'variantes' | 'lies' | 'images' | 'logistique' | 'recap';

export const WIZARD_STEPS: WizardStep[] = [
  'general', 'tarification', 'stock', 'fournisseurs', 'packs',
  'variantes', 'lies', 'images', 'logistique', 'recap',
];

export const WIZARD_STEP_LABEL: Record<WizardStep, string> = {
  general: 'Général',
  tarification: 'Tarification',
  stock: 'Stock',
  fournisseurs: 'Fournisseurs',
  packs: 'Packs',
  variantes: 'Variantes',
  lies: 'Produits liés',
  images: 'Images',
  logistique: 'Logistique',
  recap: 'Récapitulatif',
};

/** Contexte non-formulaire nécessaire aux règles d'étapes. */
export interface WizardContext {
  form: FicheFormShape;
  isEdit: boolean;
  /** Magasin de publication sélectionné (obligatoire — cause racine du bug sync). */
  storeIdSelected: boolean;
  componentsCount: number;
  variantsCount: number;
  linksCount: number;
  mediaCount: number;
  prodSuppliersCount: number;
  /** Étapes explicitement marquées « Non applicable / Aucun » par l'utilisateur. */
  naAck: Partial<Record<WizardStep, boolean>>;
}

export interface StepValidation {
  /** Erreurs rattachées à des champs du formulaire (surlignage rouge). */
  fieldErrors: FicheErrors;
  /** Problèmes d'étape sans champ dédié (composants de pack, magasin, accusé N/A). */
  stepIssues: string[];
  ok: boolean;
}

const isBlank = (s: string) => (s || '').trim() === '';

/** L'étape porte-t-elle une donnée ? (sinon « Non applicable » est exigé) */
export function stepHasContent(step: WizardStep, ctx: WizardContext): boolean {
  const f = ctx.form;
  switch (step) {
    case 'fournisseurs':
      return !isBlank(f.supplierId) || ctx.prodSuppliersCount > 0;
    case 'packs':
      return ctx.componentsCount > 0;
    case 'variantes':
      return ctx.variantsCount > 0;
    case 'lies':
      return ctx.linksCount > 0;
    case 'images':
      return !isBlank(f.imageUrl) || ctx.mediaCount > 0;
    case 'logistique':
      return [
        f.weightGrams, f.widthMm, f.heightMm, f.depthMm, f.volumeMl,
        f.unitsPerCarton, f.unitsPerPack, f.cartonsPerPallet,
        f.allergens, f.ingredients, f.bestBeforeDate, f.useByDate, f.lotNumber,
      ].some((v) => !isBlank(v));
    default:
      return true; // étapes à champs obligatoires — toujours « avec contenu »
  }
}

/** Étapes optionnelles où « Non applicable / Aucun » est un choix légitime. */
export const NA_STEPS: WizardStep[] = ['fournisseurs', 'packs', 'variantes', 'lies', 'images', 'logistique'];

export function isNaAllowed(step: WizardStep, ctx: WizardContext): boolean {
  if (!NA_STEPS.includes(step)) return false;
  // Un PACK ne peut pas déclarer « aucun composant » — c'est sa définition.
  if (step === 'packs' && ctx.form.productType === 'pack') return false;
  return true;
}

/**
 * Validation d'UNE étape : erreurs de ficheValidation restreintes aux champs
 * de l'étape + règles d'obligation propres à l'assistant (owner §2).
 */
export function validateStep(step: WizardStep, ctx: WizardContext): StepValidation {
  const { form } = ctx;
  const fieldErrors: FicheErrors = {};
  const stepIssues: string[] = [];

  // Erreurs de format/domaine du module central, restreintes à l'étape.
  if (step !== 'recap') {
    const all = validateFiche(form, ctx.isEdit);
    const tab = (step === 'packs' || step === 'variantes' || step === 'lies'
      ? null
      : (step as FicheTab));
    if (tab) {
      for (const key of fieldsOfTab(tab)) {
        if (all[key]) fieldErrors[key] = all[key];
      }
    }
  }

  const require = (k: keyof FicheFormShape, msg: string) => {
    if (isBlank(form[k] as string) && !fieldErrors[k]) fieldErrors[k] = msg;
  };

  switch (step) {
    case 'general': {
      require('name', 'Le nom du produit est obligatoire.');
      if (!ctx.isEdit) require('ean', 'Le code EAN est obligatoire (scannez ou saisissez le code-barres).');
      require('categoryId', 'La catégorie est obligatoire — créez-la si besoin depuis la fiche.');
      require('unitType', "L'unité de vente est obligatoire.");
      require('productType', 'Le type de produit est obligatoire (simple, pack, variante…).');
      if (isBlank(form.sku) && isBlank(form.internalRef)) {
        fieldErrors.sku = fieldErrors.sku
          ?? 'SKU ou référence interne obligatoire (au moins l\'un des deux).';
      }
      if (isBlank(form.shortName)) {
        fieldErrors.shortName = fieldErrors.shortName
          ?? 'Le nom court affiché en caisse est obligatoire (proposé depuis le nom).';
      }
      if (!ctx.storeIdSelected) {
        stepIssues.push('Sélectionnez le magasin de publication : un produit sans magasin n\'apparaît JAMAIS en caisse.');
      }
      break;
    }
    case 'tarification': {
      require('priceTtc', 'Le prix de vente TTC est obligatoire (ex. 4,50).');
      require('taxRate', 'La TVA est obligatoire (ex. 5,5 ou 20).');
      break;
    }
    case 'stock': {
      require('stock', 'La quantité initiale en stock est obligatoire (0 accepté, mais la vente sera bloquée tant que le stock est à 0).');
      break;
    }
    case 'packs': {
      if (form.productType === 'pack' && ctx.componentsCount === 0) {
        stepIssues.push('Un pack doit contenir au moins un composant : ajoutez les produits qui le composent.');
      }
      break;
    }
    default:
      break;
  }

  // Étape optionnelle vide → accusé « Non applicable / Aucun » exigé.
  if (isNaAllowed(step, ctx) && !stepHasContent(step, ctx) && !ctx.naAck[step]) {
    stepIssues.push('Étape sans contenu : cochez « Non applicable / Aucun » pour confirmer, puis Suivant.');
  }

  return {
    fieldErrors,
    stepIssues,
    ok: Object.keys(fieldErrors).length === 0 && stepIssues.length === 0,
  };
}

/**
 * Validation finale (bouton « Valider et publier en caisse ») : toutes les
 * étapes doivent passer. Renvoie la première étape en échec pour y renvoyer
 * l'utilisateur.
 */
export function validateAll(ctx: WizardContext): {
  ok: boolean;
  firstFailing: WizardStep | null;
  fieldErrors: FicheErrors;
  stepIssues: string[];
} {
  let firstFailing: WizardStep | null = null;
  const fieldErrors: FicheErrors = {};
  const stepIssues: string[] = [];
  for (const step of WIZARD_STEPS) {
    if (step === 'recap') continue;
    const v = validateStep(step, ctx);
    if (!v.ok && firstFailing === null) firstFailing = step;
    Object.assign(fieldErrors, { ...v.fieldErrors, ...fieldErrors });
    stepIssues.push(...v.stepIssues.map((m) => `${WIZARD_STEP_LABEL[step]} : ${m}`));
  }
  return { ok: firstFailing === null, firstFailing, fieldErrors, stepIssues };
}

/** Avertissements non bloquants affichés au récapitulatif. */
export function recapWarnings(ctx: WizardContext): string[] {
  const w: string[] = [];
  const stock = parseInt((ctx.form.stock || '').trim(), 10);
  if (Number.isFinite(stock) && stock === 0) {
    w.push('Stock à 0 : le produit sera visible en caisse mais l\'encaissement sera REFUSÉ (« Insufficient stock ») tant qu\'il n\'est pas réapprovisionné.');
  }
  if (ctx.form.status !== 'active') {
    w.push('Le statut sera passé à « Actif » lors de la publication — seul un produit actif est vendable en caisse.');
  }
  return w;
}
