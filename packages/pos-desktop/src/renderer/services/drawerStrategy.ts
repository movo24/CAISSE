/**
 * Stratégie d'ouverture du tiroir-caisse selon le MODE RÉEL de l'imprimante.
 *
 * Contexte terrain (Star TSP143 / futurePRNT) : la série TSP100 (TSP113/TSP143,
 * hors TSP100IV) est une imprimante RASTER pilotée par l'hôte — le rendu est
 * fait par le driver Windows (futurePRNT) et le firmware N'INTERPRÈTE PAS les
 * commandes ESC/POS brutes. Un job RAW `ESC p` (kick tiroir) y est au mieux
 * ignoré (tiroir muet), au pire mal interprété (comportement erratique —
 * incident historique : ouverture du tiroir en boucle après envoi d'un raster
 * RAW). RÈGLE : ne JAMAIS envoyer d'ESC/POS brut à une file raster détectée.
 *
 * Chemins possibles :
 *  - `raw`   : job RAW ESC/POS `ESC p` au spooler (imprimantes ESC/POS réelles,
 *              ou TSP100IV configurée en émulation ESC/POS) ;
 *  - `queue` : job driver (GDI) minuscule vers une FILE WINDOWS DÉDIÉE au
 *              tiroir — même port que l'imprimante, driver configuré
 *              « Periph. Unit = Cash Drawer, ouverture en début de document »,
 *              sans avance papier. Une impression = une impulsion, zéro RAW ;
 *  - `refuse`: aucune voie sûre → échec HONNÊTE avec explication (jamais
 *              d'octets aveugles vers le matériel).
 *
 * Tout est PUR et testé ; l'exécution (PowerShell/winspool) reste dans le main.
 */

/** Mode de commande réel de l'imprimante, déduit du driver Windows. */
export type PrinterCommandMode =
  | 'star-raster' // TSP100/TSP143 (I/II/III) futurePRNT — raster hôte, PAS d'ESC/POS brut
  | 'star-prnt-iv' // TSP100IV — StarPRNT natif, émulation ESC/POS sélectionnable
  | 'escpos' // imprimante ESC/POS classique (EPSON TM, génériques 58/80 mm…)
  | 'unknown';

export type DrawerStrategy = 'auto' | 'raw_escpos' | 'drawer_queue' | 'driver';

export type DrawerPathDecision =
  | { path: 'raw' }
  | { path: 'queue'; queueName: string }
  /** Le pilote Star ouvre le tiroir lui-même (Peripheral Unit Control) : la
   *  caisse n'envoie AUCUNE commande. Ni succès revendiqué, ni fausse alerte. */
  | { path: 'delegated'; reason: string }
  | { path: 'refuse'; reason: string };

/**
 * Classe le driver Windows (`DriverName` de Get-Printer) en mode de commande.
 * L'ordre compte : « TSP100IV » contient « TSP100 » → tester IV d'abord.
 */
export function classifyPrinterMode(driverName: string | null | undefined): PrinterCommandMode {
  const d = (driverName || '').trim();
  if (!d) return 'unknown';
  if (/tsp1\d{2}iv|starprnt/i.test(d)) return 'star-prnt-iv';
  if (/futureprnt|tsp1\d{2}|star\s*tsp1/i.test(d)) return 'star-raster';
  if (/esc\/?pos|epson\s+tm|generic\s*\/\s*text/i.test(d)) return 'escpos';
  return 'unknown';
}

/** Libellé humain du mode (diagnostic caisse). */
export function printerModeLabel(mode: PrinterCommandMode): string {
  switch (mode) {
    case 'star-raster':
      return 'Star raster (futurePRNT) — ESC/POS brut NON supporté';
    case 'star-prnt-iv':
      return 'Star TSP100IV (StarPRNT / émulation ESC/POS)';
    case 'escpos':
      return 'ESC/POS';
    default:
      return 'Inconnu';
  }
}

/**
 * Décide du chemin d'ouverture du tiroir. JAMAIS de `raw` en mode `auto` vers
 * une file `star-raster` (cause racine terrain : tiroir muet + jobs corrompus).
 * Un choix opérateur EXPLICITE (`raw_escpos` / `drawer_queue`) est respecté —
 * il est fait depuis l'écran diagnostic, en connaissance de cause.
 */
export function decideDrawerPath(
  mode: PrinterCommandMode,
  strategy: DrawerStrategy,
  queueName: string | null | undefined,
): DrawerPathDecision {
  const queue = (queueName || '').trim();
  // Terrain : sur une TSP143 dont futurePRNT a « Peripheral Unit 1 » activé, le
  // tiroir s'ouvre à chaque impression SANS que la caisse envoie quoi que ce
  // soit. Prétendre l'avoir ouvert serait faux ; annoncer un échec l'est tout
  // autant et affole l'opérateur. On nomme donc ce cas pour ce qu'il est.
  if (strategy === 'driver') {
    return {
      path: 'delegated',
      reason:
        'Ouverture déléguée au pilote Star (Peripheral Unit Control) : le tiroir s’ouvre ' +
        'à l’impression du ticket. La caisse n’envoie aucune commande.',
    };
  }
  if (strategy === 'drawer_queue') {
    return queue
      ? { path: 'queue', queueName: queue }
      : { path: 'refuse', reason: 'Stratégie « file tiroir » choisie mais aucune file Windows configurée (écran diagnostic).' };
  }
  if (strategy === 'raw_escpos') return { path: 'raw' };
  // auto
  if (mode === 'star-raster') {
    return queue
      ? { path: 'queue', queueName: queue }
      : {
          path: 'refuse',
          reason:
            'Imprimante Star TSP100/TSP143 (futurePRNT) détectée : le kick ESC/POS brut est inopérant sur ce firmware raster. ' +
            'Configurer la file Windows dédiée au tiroir (écran diagnostic) — aucune commande aveugle ne sera envoyée.',
        };
  }
  return { path: 'raw' };
}

/* ── Résolution d'une file Windows mémorisée ────────────────────────────
 *
 * Une file mémorisée peut DISPARAÎTRE (imprimante désinstallée, renommée,
 * profil Windows différent). Sans contrôle, l'app envoie le job à un nom
 * inexistant : Windows refuse en silence et le tiroir reste muet SANS que
 * l'opérateur comprenne pourquoi. On valide donc toujours le nom mémorisé
 * contre la liste RÉELLE des files, et on nomme précisément le cas.
 */

export type QueueResolution =
  | { ok: true; queueName: string }
  | { ok: false; reason: 'not_configured' | 'vanished'; message: string; configured?: string };

/**
 * Résout une file mémorisée contre les files réellement présentes.
 *
 * La comparaison est faite sur le nom EXACT retourné par Windows (c'est le
 * `deviceName` attendu par le spooler), en tolérant seulement les espaces de
 * bord — jamais une correspondance approximative : imprimer sur « presque la
 * bonne » file est pire que refuser.
 */
export function resolveDrawerQueue(
  configured: string | null | undefined,
  availableQueues: readonly string[],
): QueueResolution {
  const wanted = (configured || '').trim();
  if (!wanted) {
    return {
      ok: false,
      reason: 'not_configured',
      message:
        'Aucune file Windows dédiée au tiroir n’est configurée. ' +
        'Écran diagnostic → « Ouverture du tiroir » → choisir la file futurePRNT du tiroir.',
    };
  }
  const match = availableQueues.find((q) => (q || '').trim() === wanted);
  if (!match) {
    return {
      ok: false,
      reason: 'vanished',
      configured: wanted,
      message:
        `La file tiroir mémorisée « ${wanted} » n’existe plus sous Windows ` +
        '(imprimante renommée, désinstallée, ou autre session Windows). ' +
        'La resélectionner dans l’écran diagnostic.',
    };
  }
  return { ok: true, queueName: match };
}

/**
 * Choisit la file d'impression GRAPHIQUE parmi les files Windows.
 *
 * Terrain : le poste expose au moins deux files Star — la file graphique
 * (« Star TSP100 Cutter (TSP143) » : « Cutter » est le NOM DE MODÈLE, pas un
 * endpoint de commande) et une file dédiée au tiroir créée à la main. Choisir
 * la file tiroir pour imprimer un ticket produirait une impulsion et quelques
 * millimètres de papier, jamais un ticket.
 *
 * Règle : ne JAMAIS auto-sélectionner la file tiroir configurée, ni une file
 * dont le nom l'annonce explicitement. PUR et testé.
 */
export function pickGraphicPrinter(
  available: readonly string[],
  configuredDrawerQueue?: string | null,
): string | null {
  const list = available.filter(Boolean);
  if (list.length === 0) return null;
  const drawer = (configuredDrawerQueue || '').trim().toLowerCase();
  const looksLikeDrawer = (n: string) => {
    const s = n.trim().toLowerCase();
    if (drawer && s === drawer) return true;
    return /\b(tiroir|drawer|cash\s*drawer|caisse)\b/.test(s);
  };
  const graphic = list.filter((n) => !looksLikeDrawer(n));
  // Toutes les files ressemblent au tiroir → on ne devine pas, on rend la 1ʳᵉ
  // (l'opérateur tranchera dans l'écran diagnostic) plutôt que rien.
  return (graphic.length > 0 ? graphic : list)[0];
}

/* ── Lecture de l'état réel d'une file Windows ──────────────────────────── */

/** État d'une file Windows tel que remonté par le main (`pos-print:listQueues`). */
export interface WindowsQueueState {
  name: string;
  driverName: string;
  portName: string;
  status: string;
  workOffline: boolean;
  queuedJobs: number;
}

/**
 * Pourquoi cette file ne sortira PAS de papier maintenant — ou `null` si rien
 * ne s'y oppose. C'est la traduction honnête du « job soumis mais rien ne
 * sort » : Windows accepte le job même quand la file est hors connexion,
 * suspendue ou en erreur.
 *
 * PUR (aucune I/O) — implémentation UNIQUE, testée.
 */
export function describeQueueState(q: WindowsQueueState | null | undefined): string | null {
  if (!q) return 'File Windows introuvable.';
  if (q.workOffline) {
    return 'File marquée « Utiliser l’imprimante hors connexion » dans Windows — les jobs s’empilent sans imprimer.';
  }
  if (/offline/i.test(q.status)) return 'Imprimante hors connexion (éteinte, ou câble USB débranché).';
  if (/paused/i.test(q.status)) return 'File d’impression suspendue dans Windows (« Reprendre l’impression »).';
  if (/paper.?out|paper.?jam|error/i.test(q.status)) {
    return `Imprimante en erreur (${q.status}) — papier, capot ou bourrage.`;
  }
  if (q.queuedJobs > 0) {
    return `${q.queuedJobs} job(s) en attente dans la file — rien ne sort : file bloquée en amont.`;
  }
  return null;
}

/* ── Persistance du choix opérateur (localStorage, garde SSR/tests) ── */

const STRATEGY_KEY = 'caisse_drawer_strategy';
const QUEUE_KEY = 'caisse_drawer_queue';

function safeGet(key: string): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* stockage indisponible → le défaut 'auto' s'applique */
  }
}

export function getDrawerStrategy(): DrawerStrategy {
  const v = safeGet(STRATEGY_KEY);
  return v === 'raw_escpos' || v === 'drawer_queue' || v === 'driver' ? v : 'auto';
}

export function setDrawerStrategy(strategy: DrawerStrategy): void {
  safeSet(STRATEGY_KEY, strategy === 'auto' ? null : strategy);
}

export function getDrawerQueueName(): string | null {
  return safeGet(QUEUE_KEY);
}

export function setDrawerQueueName(name: string | null): void {
  safeSet(QUEUE_KEY, name && name.trim() ? name.trim() : null);
}

/* ── Forçage du format de page : SUPPRIMÉ (v1.10.3) ─────────────────────────
 *
 * Ce réglage n'a plus d'objet depuis la voie GDI : le ticket est rasterisé à la
 * hauteur mesurée puis remis au pilote EN BITMAP — le bitmap EST la page, aucun
 * formulaire pilote n'intervient. Le `main` ignorait déjà le paramètre, mais la
 * case restait cochable à l'écran diagnostic : un réglage qui ne fait rien est
 * un piège de diagnostic (on croit avoir agi). Retiré de bout en bout.
 * La clé `caisse_force_page_size` éventuellement présente est simplement
 * ignorée — aucune migration nécessaire.
 */
