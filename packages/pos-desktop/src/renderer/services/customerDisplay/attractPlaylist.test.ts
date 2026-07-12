import { describe, it, expect } from 'vitest';
import {
  advance,
  preloadUrl,
  imageDurationMs,
  normalizePlaylist,
  DEFAULT_IMAGE_DURATION_SECONDS,
  type AttractMediaItem,
} from './attractPlaylist';

const vid = (url: string): AttractMediaItem => ({ type: 'video', url, durationSeconds: null });
const img = (url: string, d: number | null = null): AttractMediaItem => ({ type: 'image', url, durationSeconds: d });

describe('attractPlaylist — advance', () => {
  it('avance jusqu’au dernier puis boucle à 0', () => {
    expect(advance(0, 3, true)).toBe(1);
    expect(advance(1, 3, true)).toBe(2);
    expect(advance(2, 3, true)).toBe(0);
  });

  it('sans boucle, renvoie null après le dernier', () => {
    expect(advance(2, 3, false)).toBeNull();
    expect(advance(1, 3, false)).toBe(2);
  });

  it('playlist vide → null', () => {
    expect(advance(0, 0, true)).toBeNull();
  });

  it('un seul média : boucle sur lui-même, sinon fin', () => {
    expect(advance(0, 1, true)).toBe(0);
    expect(advance(0, 1, false)).toBeNull();
  });
});

describe('attractPlaylist — preloadUrl', () => {
  const media = [vid('a.mp4'), vid('b.mp4'), img('c.png')];
  it('précharge le média suivant', () => {
    expect(preloadUrl(media, 0, true)).toBe('b.mp4');
    expect(preloadUrl(media, 1, true)).toBe('c.png');
  });
  it('boucle : après le dernier précharge le premier', () => {
    expect(preloadUrl(media, 2, true)).toBe('a.mp4');
  });
  it('sans boucle : rien à précharger après le dernier', () => {
    expect(preloadUrl(media, 2, false)).toBeNull();
  });
});

describe('attractPlaylist — imageDurationMs', () => {
  it('utilise la durée fournie', () => {
    expect(imageDurationMs(img('x.png', 4))).toBe(4000);
  });
  it('replie sur la durée par défaut si absente ou invalide', () => {
    expect(imageDurationMs(img('x.png', null))).toBe(DEFAULT_IMAGE_DURATION_SECONDS * 1000);
    expect(imageDurationMs(img('x.png', 0))).toBe(DEFAULT_IMAGE_DURATION_SECONDS * 1000);
  });
});

describe('attractPlaylist — normalizePlaylist', () => {
  it('normalise une playlist valide, boucle par défaut', () => {
    const pl = normalizePlaylist({
      campaignId: 'c1',
      media: [
        { type: 'video', url: 'a.mp4' },
        { type: 'image', url: 'b.png', durationSeconds: 5 },
      ],
    });
    expect(pl).not.toBeNull();
    expect(pl!.campaignId).toBe('c1');
    expect(pl!.loop).toBe(true);
    expect(pl!.media.map((m) => m.url)).toEqual(['a.mp4', 'b.png']);
    expect(pl!.media[1].durationSeconds).toBe(5);
  });

  it('filtre les médias sans URL et respecte loop=false', () => {
    const pl = normalizePlaylist({
      media: [{ type: 'video', url: '' }, { type: 'video', url: 'ok.mp4' }],
      loop: false,
    });
    expect(pl!.media.map((m) => m.url)).toEqual(['ok.mp4']);
    expect(pl!.loop).toBe(false);
  });

  it('type inconnu → traité comme vidéo', () => {
    const pl = normalizePlaylist({ media: [{ type: 'gif', url: 'x' }] });
    expect(pl!.media[0].type).toBe('video');
  });

  it('null / vide / sans média jouable → null', () => {
    expect(normalizePlaylist(null)).toBeNull();
    expect(normalizePlaylist({})).toBeNull();
    expect(normalizePlaylist({ media: [] })).toBeNull();
    expect(normalizePlaylist({ media: [{ type: 'video' }] })).toBeNull();
    expect(normalizePlaylist('nope')).toBeNull();
  });
});
