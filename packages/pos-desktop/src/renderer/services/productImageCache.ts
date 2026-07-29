import { productsApi } from './api';

/**
 * Cache mémoire des images produit récupérées À LA DEMANDE.
 *
 * Le catalogue POS est désormais servi SANS `imageUrl` (projection légère
 * `view=pos`) pour économiser le transfert réseau (le poll tourne toutes les
 * 15 s). La vraie photo n'est donc plus dans la liste : la vignette du panier
 * la récupère ici, UNE seule fois par produit, à la première fois qu'il entre
 * dans un panier — puis c'est servi depuis le cache.
 *
 * Économie : image lue 1 fois par produit distinct vendu (rare) au lieu de
 * TOUS les produits toutes les 15 s (constant). Échec réseau → null → la
 * vignette retombe proprement sur l'avatar-initiales (jamais d'image cassée).
 */
const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

export async function getProductImage(productId: string): Promise<string | null> {
  if (!productId) return null;
  if (cache.has(productId)) return cache.get(productId) ?? null;
  const pending = inflight.get(productId);
  if (pending) return pending;

  const p = productsApi
    .get(productId)
    .then((res) => {
      const url: string | null = res?.data?.imageUrl ?? null;
      cache.set(productId, url);
      return url;
    })
    .catch(() => {
      // Pas de mise en cache d'un échec réseau : réessayable plus tard.
      return null;
    })
    .finally(() => {
      inflight.delete(productId);
    });

  inflight.set(productId, p);
  return p;
}

/** Réservé aux tests. */
export function __clearProductImageCache(): void {
  cache.clear();
  inflight.clear();
}
