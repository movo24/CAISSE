/**
 * Customer Display — media validation (pure part is fully unit-testable).
 *
 * The idle video is a customer-facing marketing asset. It must be a safe,
 * reasonably-sized, vertical (9:16) video. This module owns the *rules*; the
 * browser-dependent probing (reading real pixel dimensions from a File) lives
 * at the bottom and delegates to the pure `validateVideoRatio`.
 *
 * Hard rule: a bad/huge/wrong-format upload must never be able to slow down or
 * break the register — validation happens before anything is stored.
 */

/** Allowed MIME types for the idle video. */
export const ALLOWED_VIDEO_MIME = ['video/mp4', 'video/webm'] as const;
export type AllowedVideoMime = (typeof ALLOWED_VIDEO_MIME)[number];

/** Default maximum size (bytes). Configurable by the caller. */
export const DEFAULT_MAX_VIDEO_BYTES = 60 * 1024 * 1024; // 60 MB

/** Target vertical ratio (9:16) and the tolerance we accept around it. */
export const TARGET_RATIO = 9 / 16;
export const RATIO_TOLERANCE = 0.06;

export interface MediaValidationResult {
  ok: boolean;
  /** Machine-readable reason when !ok. */
  code?: 'empty' | 'bad_mime' | 'too_large' | 'not_vertical' | 'bad_dimensions';
  /** Human, customer-safe message (French). */
  message?: string;
  /** Detected orientation, when dimensions were provided. */
  orientation?: 'portrait' | 'landscape' | 'square';
  ratio?: number;
}

export interface MediaFileMeta {
  type: string;
  size: number;
  name?: string;
}

/** Validate the file envelope (type + size) — no pixels required. */
export function validateMediaFile(
  meta: MediaFileMeta,
  maxBytes: number = DEFAULT_MAX_VIDEO_BYTES,
): MediaValidationResult {
  if (!meta || !meta.size || meta.size <= 0) {
    return { ok: false, code: 'empty', message: 'Fichier vidéo vide ou illisible.' };
  }
  if (!ALLOWED_VIDEO_MIME.includes(meta.type as AllowedVideoMime)) {
    return {
      ok: false,
      code: 'bad_mime',
      message: 'Format non supporté. Utilisez un fichier MP4 ou WebM.',
    };
  }
  if (meta.size > maxBytes) {
    const mb = Math.round(maxBytes / (1024 * 1024));
    return {
      ok: false,
      code: 'too_large',
      message: `Vidéo trop lourde (max ${mb} Mo). Compressez-la avant l'import.`,
    };
  }
  return { ok: true };
}

/**
 * Validate pixel dimensions for a vertical (9:16) video. Landscape or near-square
 * videos are rejected with a clear, non-technical message.
 */
export function validateVideoRatio(width: number, height: number): MediaValidationResult {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { ok: false, code: 'bad_dimensions', message: 'Dimensions vidéo invalides.' };
  }
  const ratio = width / height;
  const orientation: 'portrait' | 'landscape' | 'square' =
    ratio < 0.98 ? 'portrait' : ratio > 1.02 ? 'landscape' : 'square';

  // Accept anything clearly portrait and close enough to 9:16.
  const withinTolerance = Math.abs(ratio - TARGET_RATIO) <= RATIO_TOLERANCE;
  const acceptablePortrait = orientation === 'portrait' && ratio <= 0.75; // ≤ 3:4, still vertical

  if (!withinTolerance && !acceptablePortrait) {
    return {
      ok: false,
      code: 'not_vertical',
      message:
        orientation === 'landscape'
          ? 'La vidéo est horizontale. L’écran client attend un format vertical 9:16 (1080×1920).'
          : 'Format non vertical. Utilisez une vidéo 9:16 (recommandé 1080×1920).',
      orientation,
      ratio,
    };
  }
  return { ok: true, orientation, ratio };
}

/** Sanitize a user-supplied file name for safe storage/display. */
export function safeFileName(name: string | undefined, fallback = 'idle-video'): string {
  if (!name || typeof name !== 'string') return fallback;
  const base = name.split(/[\\/]/).pop() || fallback;
  const cleaned = base
    .normalize('NFKD')
    .replace(/[^\w.\- ]+/g, '')
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(0, 80)
    .trim();
  return cleaned || fallback;
}

/** Human helper for the panel: format a byte count. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 o';
  const units = ['o', 'Ko', 'Mo', 'Go'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Probe a video File for its intrinsic dimensions (browser-only). Resolves with
 * a validation result. Never rejects — on any error it returns a bad_dimensions
 * result so callers can fail closed without try/catch. Not unit-tested (needs a
 * real <video> element); the rule it applies (`validateVideoRatio`) is.
 */
export function probeVideoRatio(file: Blob): Promise<MediaValidationResult> {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      const cleanup = () => URL.revokeObjectURL(url);
      video.onloadedmetadata = () => {
        const res = validateVideoRatio(video.videoWidth, video.videoHeight);
        cleanup();
        resolve(res);
      };
      video.onerror = () => {
        cleanup();
        resolve({ ok: false, code: 'bad_dimensions', message: 'Vidéo illisible.' });
      };
      video.src = url;
    } catch {
      resolve({ ok: false, code: 'bad_dimensions', message: 'Vidéo illisible.' });
    }
  });
}
