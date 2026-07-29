/**
 * Cache d'image produit à la demande (P0-a — réduction transfert Railway).
 *
 * Le catalogue POS est servi SANS imageUrl : la vignette panier récupère la
 * photo ici, une seule fois par produit, puis depuis le cache. Prouve : un seul
 * appel réseau par produit (même si demandé plusieurs fois / en concurrence),
 * et un échec réseau → null (repli initiales), sans empoisonner le cache.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const get = vi.fn();
vi.mock('./api', () => ({ productsApi: { get: (id: string) => get(id) } }));

import { getProductImage, __clearProductImageCache } from './productImageCache';

beforeEach(() => {
  get.mockReset();
  __clearProductImageCache();
});

describe('getProductImage', () => {
  it('récupère la photo puis la sert depuis le cache — UN seul appel réseau', async () => {
    get.mockResolvedValue({ data: { imageUrl: 'data:image/png;base64,AAA' } });
    expect(await getProductImage('p1')).toBe('data:image/png;base64,AAA');
    expect(await getProductImage('p1')).toBe('data:image/png;base64,AAA');
    expect(await getProductImage('p1')).toBe('data:image/png;base64,AAA');
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('déduplique les appels concurrents (single-flight)', async () => {
    let resolve!: (v: any) => void;
    get.mockReturnValue(new Promise((r) => { resolve = r; }));
    const a = getProductImage('p2');
    const b = getProductImage('p2');
    resolve({ data: { imageUrl: 'data:image/png;base64,BBB' } });
    expect(await a).toBe('data:image/png;base64,BBB');
    expect(await b).toBe('data:image/png;base64,BBB');
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('produit sans image → null mis en cache (pas de re-fetch)', async () => {
    get.mockResolvedValue({ data: { imageUrl: null } });
    expect(await getProductImage('p3')).toBeNull();
    expect(await getProductImage('p3')).toBeNull();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('échec réseau → null SANS empoisonner le cache (réessayable)', async () => {
    get.mockRejectedValueOnce(new Error('offline'));
    expect(await getProductImage('p4')).toBeNull();
    get.mockResolvedValueOnce({ data: { imageUrl: 'data:image/png;base64,CCC' } });
    expect(await getProductImage('p4')).toBe('data:image/png;base64,CCC'); // re-tenté
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('productId vide → null, aucun appel', async () => {
    expect(await getProductImage('')).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });
});
