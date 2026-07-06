/**
 * Customer Display — settings model (pure, framework-free, unit-testable).
 *
 * Screen 2 (the customer-facing display) is a real, separately-configured
 * product. Its configuration lives on the terminal (localStorage) under the
 * logical `customer_display_*` field names required by the spec, serialised as
 * a single JSON blob (consistent with existing per-terminal state such as
 * `caisse_suspended_tickets`). The blob is broadcast live to the display
 * window; nothing here reads or writes cart/payment/fiscal state.
 *
 * Everything in this file is pure except the two localStorage helpers at the
 * bottom, which only touch a single, non-business key.
 */

/** Idle/behaviour mode of the client display. */
export type CustomerDisplayMode =
  | 'auto'            // idle = video if present else branding; ticket during sale
  | 'video_only'      // idle = video loop only
  | 'ticket_video'    // idle = video; sale = ticket with reduced video backdrop
  | 'ticket_fullscreen' // sale = ticket fullscreen (no video during sale)
  | 'branding';       // idle = branding message only (no video)

export const CUSTOMER_DISPLAY_MODES: { value: CustomerDisplayMode; label: string }[] = [
  { value: 'auto', label: 'Automatique (vidéo idle + ticket vente)' },
  { value: 'video_only', label: 'Vidéo seule en idle' },
  { value: 'ticket_video', label: 'Ticket + vidéo réduite' },
  { value: 'ticket_fullscreen', label: 'Ticket plein écran pendant vente' },
  { value: 'branding', label: 'Message branding simple' },
];

export type CustomerDisplayQrType =
  | 'instagram'
  | 'google_review'
  | 'loyalty'
  | 'digital_ticket'
  | 'jackpot'
  | 'tiktok'
  | 'custom';

export const CUSTOMER_DISPLAY_QR_TYPES: { value: CustomerDisplayQrType; label: string }[] = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'google_review', label: 'Avis Google' },
  { value: 'loyalty', label: 'Programme fidélité' },
  { value: 'digital_ticket', label: 'Ticket digital' },
  { value: 'jackpot', label: 'Jeu jackpot' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'custom', label: 'Lien personnalisé' },
];

export type CustomerDisplayOrientation = 'portrait' | 'landscape';

/**
 * Full settings object. Field names mirror the required `customer_display_*`
 * keys (camelCased). `blackout` / `lastSeenAt` are runtime/ephemeral but kept
 * here so a single serialisation round-trips the whole state.
 */
export interface CustomerDisplaySettings {
  enabled: boolean;                  // customer_display_enabled
  mode: CustomerDisplayMode;         // customer_display_mode
  screenId: number | null;          // customer_display_screen_id (Electron display id)
  orientation: CustomerDisplayOrientation; // customer_display_orientation
  resolution: string | null;        // customer_display_resolution (e.g. "1080x1920")
  mediaId: string | null;           // customer_display_media_id (IndexedDB key)
  idleTimeoutSeconds: number;        // customer_display_idle_timeout_seconds
  successTimeoutSeconds: number;     // customer_display_success_timeout_seconds
  showQr: boolean;                   // customer_display_show_qr
  qrType: CustomerDisplayQrType;     // customer_display_qr_type
  qrValue: string;                   // URL/value encoded in the QR
  blackout: boolean;                 // customer_display_blackout
  lastSeenAt: string | null;         // customer_display_last_seen_at (ISO)
  terminalId: string;                // customer_display_terminal_id (e.g. "01")
  storeId: string | null;            // customer_display_store_id
  storeName: string;                 // branding: shop name
  slogans: string[];                 // idle rotating slogans
}

export const CUSTOMER_DISPLAY_STORAGE_KEY = 'customer_display_settings';

/** The channel name used for cross-window sync. Exported for the bus + tests. */
export const CUSTOMER_DISPLAY_CHANNEL = 'caisse-customer-display';

export const DEFAULT_CUSTOMER_DISPLAY_SETTINGS: CustomerDisplaySettings = {
  enabled: true,
  mode: 'auto',
  screenId: null,
  orientation: 'portrait',
  resolution: null,
  mediaId: null,
  idleTimeoutSeconds: 8,
  successTimeoutSeconds: 6,
  showQr: true,
  qrType: 'instagram',
  qrValue: 'https://instagram.com/thewesleys',
  blackout: false,
  lastSeenAt: null,
  terminalId: '01',
  storeId: null,
  storeName: "The Wesley's",
  slogans: [
    'Bienvenue chez The Wesley’s',
    'Prix bas toute l’année',
    'Pas besoin d’attendre trois semaines',
  ],
};

const MODE_VALUES = new Set<string>(CUSTOMER_DISPLAY_MODES.map((m) => m.value));
const QR_VALUES = new Set<string>(CUSTOMER_DISPLAY_QR_TYPES.map((q) => q.value));

/** Clamp a number into [min, max], falling back to `fallback` when not finite. */
function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Normalise an arbitrary (possibly partial / corrupted) object into a valid
 * settings object. Never throws — always returns a usable configuration. This
 * is the single validation entry point the UI and the display both use.
 */
export function normalizeSettings(raw: unknown): CustomerDisplaySettings {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_CUSTOMER_DISPLAY_SETTINGS;

  const mode = typeof src.mode === 'string' && MODE_VALUES.has(src.mode)
    ? (src.mode as CustomerDisplayMode)
    : d.mode;

  const qrType = typeof src.qrType === 'string' && QR_VALUES.has(src.qrType)
    ? (src.qrType as CustomerDisplayQrType)
    : d.qrType;

  const orientation: CustomerDisplayOrientation =
    src.orientation === 'landscape' ? 'landscape' : 'portrait';

  let slogans: string[] = d.slogans;
  if (Array.isArray(src.slogans)) {
    const cleaned = src.slogans
      .filter((s): s is string => typeof s === 'string')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, 8);
    if (cleaned.length > 0) slogans = cleaned;
  }

  const screenId =
    src.screenId === null || src.screenId === undefined
      ? null
      : (() => {
          const n = Number(src.screenId);
          return Number.isFinite(n) ? n : null;
        })();

  return {
    enabled: typeof src.enabled === 'boolean' ? src.enabled : d.enabled,
    mode,
    screenId,
    orientation,
    resolution: typeof src.resolution === 'string' && src.resolution ? src.resolution : null,
    mediaId: typeof src.mediaId === 'string' && src.mediaId ? src.mediaId : null,
    // Idle rotation must be at least 3s; success screen 2..60s.
    idleTimeoutSeconds: clampNumber(src.idleTimeoutSeconds, 3, 120, d.idleTimeoutSeconds),
    successTimeoutSeconds: clampNumber(src.successTimeoutSeconds, 2, 60, d.successTimeoutSeconds),
    showQr: typeof src.showQr === 'boolean' ? src.showQr : d.showQr,
    qrType,
    qrValue: typeof src.qrValue === 'string' ? src.qrValue : d.qrValue,
    blackout: typeof src.blackout === 'boolean' ? src.blackout : d.blackout,
    lastSeenAt: typeof src.lastSeenAt === 'string' ? src.lastSeenAt : null,
    terminalId: normalizeTerminalId(src.terminalId, d.terminalId),
    storeId: typeof src.storeId === 'string' && src.storeId ? src.storeId : null,
    storeName: typeof src.storeName === 'string' && src.storeName.trim() ? src.storeName.trim() : d.storeName,
    slogans,
  };
}

/**
 * Terminal id shown to customers ("TERMINAL 01"). Accepts "1", 1, "01",
 * "Terminal 2" → normalised to a 2-digit string where possible.
 */
export function normalizeTerminalId(raw: unknown, fallback = '01'): string {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return String(Math.max(0, Math.trunc(raw))).padStart(2, '0');
  }
  if (typeof raw === 'string') {
    const digits = raw.replace(/\D/g, '');
    if (digits) return digits.padStart(2, '0').slice(-3);
    if (raw.trim()) return raw.trim().slice(0, 12);
  }
  return fallback;
}

/** Human-facing label: "TERMINAL 02". */
export function terminalLabel(terminalId: string): string {
  const t = normalizeTerminalId(terminalId);
  return /^\d+$/.test(t) ? `TERMINAL ${t}` : t.toUpperCase();
}

// ── localStorage persistence (only touches the single settings key) ──

export function loadSettings(): CustomerDisplaySettings {
  try {
    const raw = localStorage.getItem(CUSTOMER_DISPLAY_STORAGE_KEY);
    return normalizeSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_CUSTOMER_DISPLAY_SETTINGS };
  }
}

export function saveSettings(settings: CustomerDisplaySettings): CustomerDisplaySettings {
  const normalized = normalizeSettings(settings);
  try {
    localStorage.setItem(CUSTOMER_DISPLAY_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    /* storage full / unavailable — settings still returned for in-memory use */
  }
  return normalized;
}
