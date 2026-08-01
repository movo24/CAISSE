/**
 * Classification des échecs de connexion.
 *
 * Avant : toute erreur sans `response.data.message` exploitable retombait sur
 * « Erreur de connexion » — un backend HS (502) et un PIN faux produisaient le
 * même écran, rendant tout diagnostic impossible. On sépare désormais les quatre
 * situations que l'exploitant doit pouvoir distinguer d'un coup d'œil :
 * identifiants refusés, serveur indisponible, erreur interne serveur, réseau absent.
 */

export type AuthErrorKind =
  | 'credentials' // 401/403 — l'authentification a été refusée par le serveur
  | 'rate_limited' // 429 — trop de tentatives, compte NON verrouillé
  | 'unavailable' // 502/503/504 ou délai dépassé — le backend ne répond pas
  | 'server' // 5xx applicatif — le backend répond mais échoue
  | 'offline' // aucune requête n'a quitté la machine (réseau coupé)
  | 'bad_request' // 400/422 — payload refusé
  | 'unknown';

export interface ClassifiedAuthError {
  kind: AuthErrorKind;
  /** Message destiné à l'utilisateur, sans jargon. */
  message: string;
  /** Ligne technique (URL réellement appelée + code) pour le diagnostic. */
  detail: string;
  /** Code HTTP réel, `null` si aucune réponse n'est arrivée. */
  status: number | null;
}

/** URL absolue réellement appelée, telle que reconstruite par axios. */
function requestUrl(err: any): string {
  const cfg = err?.config;
  if (!cfg) return 'URL inconnue';
  const base = cfg.baseURL || '';
  const url = cfg.url || '';
  const joined = /^https?:\/\//i.test(url) ? url : `${base}${url}`;
  // baseURL relative (rewrite Vercel/proxy Vite) : on préfixe l'origine réelle.
  if (joined.startsWith('/') && typeof window !== 'undefined') {
    return `${window.location.origin}${joined}`;
  }
  return joined || 'URL inconnue';
}

/** Message serveur exploitable, uniquement s'il est réellement lisible. */
function serverMessage(err: any): string | null {
  const msg = err?.response?.data?.message;
  if (typeof msg === 'string' && msg.trim()) return msg.trim();
  if (Array.isArray(msg) && msg.length) return msg.map(String).join(', ');
  return null;
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export function classifyAuthError(err: any): ClassifiedAuthError {
  const url = requestUrl(err);
  const status: number | null =
    typeof err?.response?.status === 'number' ? err.response.status : null;
  const fromServer = serverMessage(err);

  // ── Aucune réponse HTTP reçue ──────────────────────────────────────────
  if (status === null) {
    const code = err?.code ? String(err.code) : 'ERR_UNKNOWN';
    const timedOut = code === 'ECONNABORTED' || /timeout/i.test(String(err?.message || ''));

    if (isOffline()) {
      return {
        kind: 'offline',
        message: 'Aucune connexion réseau — cet ordinateur est hors ligne.',
        detail: `${url} — requête non émise (${code})`,
        status: null,
      };
    }
    if (timedOut) {
      return {
        kind: 'unavailable',
        message:
          'Serveur indisponible — le backend n’a pas répondu dans le délai imparti. Vos identifiants n’ont pas été vérifiés.',
        detail: `${url} — délai dépassé (${code})`,
        status: null,
      };
    }
    return {
      kind: 'unavailable',
      message:
        'Serveur injoignable — impossible d’atteindre le backend. Vos identifiants n’ont pas été vérifiés.',
      detail: `${url} — aucune réponse (${code})`,
      status: null,
    };
  }

  // ── Une réponse HTTP est arrivée : le code fait foi ────────────────────
  if (status === 401 || status === 403) {
    return {
      kind: 'credentials',
      message: fromServer || 'Identifiants incorrects — e-mail ou code PIN invalide.',
      detail: `${url} — HTTP ${status}`,
      status,
    };
  }
  if (status === 429) {
    return {
      kind: 'rate_limited',
      message:
        'Trop de tentatives de connexion — patientez quelques minutes avant de réessayer. Le compte n’est pas bloqué.',
      detail: `${url} — HTTP 429`,
      status,
    };
  }
  if (status === 502 || status === 503 || status === 504) {
    return {
      kind: 'unavailable',
      message:
        'Serveur indisponible — le backend est arrêté ou en cours de redémarrage. Vos identifiants n’ont pas été vérifiés.',
      detail: `${url} — HTTP ${status}${fromServer ? ` (${fromServer})` : ''}`,
      status,
    };
  }
  if (status >= 500) {
    return {
      kind: 'server',
      message:
        'Erreur interne du serveur — le backend a répondu en échec. Ce n’est pas un problème d’identifiants.',
      detail: `${url} — HTTP ${status}${fromServer ? ` (${fromServer})` : ''}`,
      status,
    };
  }
  if (status === 400 || status === 422) {
    return {
      kind: 'bad_request',
      message: fromServer || 'Requête refusée — vérifiez le format de l’e-mail et du code PIN.',
      detail: `${url} — HTTP ${status}`,
      status,
    };
  }

  return {
    kind: 'unknown',
    message: fromServer || `Échec de la connexion (HTTP ${status}).`,
    detail: `${url} — HTTP ${status}`,
    status,
  };
}
