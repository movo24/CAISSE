import api from './api';

/**
 * Client de télémétrie de consultation — envoi BATCHÉ et NON BLOQUANT vers
 * POST /activity/view-events. Noms d'actions métier stables (whitelist côté serveur).
 * Une panne d'envoi n'a AUCUN impact sur l'UI (spec §9/§17). Aucune donnée sensible :
 * ne jamais mettre de mot de passe / token / recherche intégrale dans `metadata`.
 */
export interface ViewEvent {
  action: string;
  module?: string;
  screen?: string;
  storeId?: string;
  entityType?: string;
  entityId?: string;
  sourceRoute?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

const FLUSH_MS = 5000;
const MAX_BATCH = 25;

let queue: ViewEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function schedule(): void {
  if (!timer) timer = setTimeout(() => void flush(), FLUSH_MS);
}

export async function flush(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!queue.length) return;
  // Pas de token = pas d'envoi (l'ingestion est authentifiée).
  if (!localStorage.getItem('accessToken')) {
    queue = [];
    return;
  }
  const batch = queue.splice(0, MAX_BATCH);
  try {
    await api.post('/activity/view-events', { events: batch });
  } catch {
    /* télémétrie non bloquante — on n'échoue jamais l'UI */
  }
  if (queue.length) schedule();
}

/** Enfile un événement de consultation. Flush immédiat si le lot est plein. */
export function trackView(e: ViewEvent): void {
  queue.push(e);
  if (queue.length >= MAX_BATCH) void flush();
  else schedule();
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    void flush();
  });
}
