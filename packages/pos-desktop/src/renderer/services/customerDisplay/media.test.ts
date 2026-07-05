import { describe, it, expect } from 'vitest';
import {
  validateMediaFile,
  validateVideoRatio,
  safeFileName,
  formatBytes,
  DEFAULT_MAX_VIDEO_BYTES,
} from './media';

describe('validateMediaFile', () => {
  it('rejects empty file', () => {
    expect(validateMediaFile({ type: 'video/mp4', size: 0 }).code).toBe('empty');
  });

  it('rejects non-mp4/webm', () => {
    expect(validateMediaFile({ type: 'video/quicktime', size: 1000 }).code).toBe('bad_mime');
    expect(validateMediaFile({ type: 'image/png', size: 1000 }).code).toBe('bad_mime');
    expect(validateMediaFile({ type: 'application/x-msdownload', size: 1000 }).code).toBe('bad_mime');
  });

  it('accepts mp4 and webm within size', () => {
    expect(validateMediaFile({ type: 'video/mp4', size: 1024 }).ok).toBe(true);
    expect(validateMediaFile({ type: 'video/webm', size: 1024 }).ok).toBe(true);
  });

  it('rejects oversize files', () => {
    expect(validateMediaFile({ type: 'video/mp4', size: DEFAULT_MAX_VIDEO_BYTES + 1 }).code).toBe('too_large');
  });

  it('honours a custom max size', () => {
    expect(validateMediaFile({ type: 'video/mp4', size: 2000 }, 1000).code).toBe('too_large');
    expect(validateMediaFile({ type: 'video/mp4', size: 500 }, 1000).ok).toBe(true);
  });
});

describe('validateVideoRatio', () => {
  it('accepts exact 9:16 (1080x1920)', () => {
    const r = validateVideoRatio(1080, 1920);
    expect(r.ok).toBe(true);
    expect(r.orientation).toBe('portrait');
  });

  it('accepts other vertical resolutions (720x1280, 1440x2560)', () => {
    expect(validateVideoRatio(720, 1280).ok).toBe(true);
    expect(validateVideoRatio(1440, 2560).ok).toBe(true);
  });

  it('rejects landscape 1920x1080', () => {
    const r = validateVideoRatio(1920, 1080);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('not_vertical');
    expect(r.orientation).toBe('landscape');
    expect(r.message).toMatch(/horizontale/i);
  });

  it('rejects square 1000x1000', () => {
    const r = validateVideoRatio(1000, 1000);
    expect(r.ok).toBe(false);
    expect(r.orientation).toBe('square');
  });

  it('accepts a portrait 3:4 (still vertical) but rejects mild portrait 4:5', () => {
    expect(validateVideoRatio(1080, 1440).ok).toBe(true); // 0.75 → accepted
    expect(validateVideoRatio(1080, 1350).ok).toBe(false); // 0.8 → too square
  });

  it('rejects invalid dimensions', () => {
    expect(validateVideoRatio(0, 100).code).toBe('bad_dimensions');
    expect(validateVideoRatio(NaN, 100).code).toBe('bad_dimensions');
  });
});

describe('safeFileName', () => {
  it('strips paths and dangerous characters', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('my promo!!.mp4')).toBe('my_promo.mp4');
    expect(safeFileName('a/b/c/clip.webm')).toBe('clip.webm');
  });

  it('falls back when empty', () => {
    expect(safeFileName('')).toBe('idle-video');
    expect(safeFileName(undefined)).toBe('idle-video');
  });
});

describe('formatBytes', () => {
  it('formats human sizes', () => {
    expect(formatBytes(0)).toBe('0 o');
    expect(formatBytes(1024)).toBe('1.0 Ko');
    expect(formatBytes(60 * 1024 * 1024)).toBe('60.0 Mo');
  });
});
