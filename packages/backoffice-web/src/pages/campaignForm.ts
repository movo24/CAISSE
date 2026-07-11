/**
 * Attract campaigns — form model (pur, testable, sans React).
 *
 * Convertit l'état d'édition (chaînes de formulaire) en payload backend aligné
 * sur `CreateAttractCampaignDto` / `UpdateAttractCampaignDto`, et valide les
 * invariants côté UI avant l'appel réseau. Aucune dépendance framework.
 */

export type AttractMediaType = 'video' | 'image';

export interface MediaFormItem {
  type: AttractMediaType;
  url: string;
  /** Durée en secondes (chaîne de formulaire ; '' = défaut serveur). */
  durationSeconds: string;
}

export interface CampaignFormState {
  name: string;
  scope: 'store' | 'national';
  isActive: boolean;
  loop: boolean;
  /** Valeurs d'`<input type="datetime-local">` ('' = pas de borne). */
  startsAt: string;
  endsAt: string;
  /** Priorité (chaîne de formulaire ; '' = 0). */
  priority: string;
  /** Caisses ciblées, saisies en CSV ('' = toutes). */
  terminalIdsCsv: string;
  media: MediaFormItem[];
}

export const EMPTY_CAMPAIGN_FORM: CampaignFormState = {
  name: '',
  scope: 'store',
  isActive: true,
  loop: true,
  startsAt: '',
  endsAt: '',
  priority: '0',
  terminalIdsCsv: '',
  media: [],
};

export interface CampaignPayload {
  name: string;
  scope: 'store' | 'national';
  isActive: boolean;
  loop: boolean;
  startsAt: string | null;
  endsAt: string | null;
  priority: number;
  terminalIds: string[] | null;
  media: Array<{ type: AttractMediaType; url: string; durationSeconds?: number }>;
}

/** CSV de caisses → liste normalisée (trim, non vides, dédupliquée). null si vide. */
export function parseTerminalIds(csv: string): string[] | null {
  const ids = csv
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const unique = Array.from(new Set(ids));
  return unique.length > 0 ? unique : null;
}

/** `datetime-local` (heure locale) → ISO 8601 UTC. '' → null. */
export function localToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** ISO 8601 → valeur `datetime-local` (heure locale). null/'' → ''. */
export function isoToLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // Décale vers l'heure locale puis tronque les secondes/fuseau.
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

/**
 * Valide le formulaire. Renvoie un message d'erreur (FR) ou `null` si OK.
 * `isAdmin` : seul un admin peut créer/éditer une campagne nationale.
 */
export function validateCampaignForm(form: CampaignFormState, isAdmin: boolean): string | null {
  if (!form.name.trim()) return 'Le nom de la campagne est obligatoire.';
  if (form.name.trim().length > 200) return 'Le nom ne peut pas dépasser 200 caractères.';
  if (form.scope === 'national' && !isAdmin) {
    return 'Seul un administrateur peut créer une campagne nationale.';
  }
  if (form.priority.trim() !== '') {
    const p = Number(form.priority);
    if (!Number.isInteger(p)) return 'La priorité doit être un entier.';
  }
  const start = localToIso(form.startsAt);
  const end = localToIso(form.endsAt);
  if (start && end && new Date(start) >= new Date(end)) {
    return 'La date de fin doit être postérieure à la date de début.';
  }
  for (const [i, m] of form.media.entries()) {
    if (!m.url.trim()) return `Média ${i + 1} : l'URL est obligatoire.`;
    if (m.durationSeconds.trim() !== '') {
      const d = Number(m.durationSeconds);
      if (!Number.isFinite(d) || d < 0) return `Média ${i + 1} : durée invalide.`;
    }
  }
  return null;
}

/** Construit le payload backend depuis le formulaire (validé au préalable). */
export function buildCampaignPayload(form: CampaignFormState): CampaignPayload {
  const priority = form.priority.trim() === '' ? 0 : Math.trunc(Number(form.priority));
  return {
    name: form.name.trim(),
    scope: form.scope,
    isActive: form.isActive,
    loop: form.loop,
    startsAt: localToIso(form.startsAt),
    endsAt: localToIso(form.endsAt),
    priority: Number.isFinite(priority) ? priority : 0,
    terminalIds: parseTerminalIds(form.terminalIdsCsv),
    media: form.media.map((m) => {
      const item: { type: AttractMediaType; url: string; durationSeconds?: number } = {
        type: m.type,
        url: m.url.trim(),
      };
      if (m.durationSeconds.trim() !== '') {
        const d = Math.trunc(Number(m.durationSeconds));
        if (Number.isFinite(d) && d >= 0) item.durationSeconds = d;
      }
      return item;
    }),
  };
}
