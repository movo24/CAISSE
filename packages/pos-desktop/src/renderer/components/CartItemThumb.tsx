import React, { useState, useEffect } from 'react';
import { avatarColor, initials } from '../utils/productDisplay';

/**
 * Vignette d'une ligne du panier : la VRAIE photo produit si disponible, sinon
 * un avatar coloré aux initiales (fallback historique — c'était l'unique rendu,
 * d'où le « carré CB » pour « Charbon Black Coco » faute d'image).
 *
 * La photo est une data-URL persistée (base `products.image_url`, synchronisée
 * dans le cache catalogue POS) : elle survit au redémarrage et ne dépend d'aucune
 * URL expirable. La CSP POS autorise `img-src data:`. En cas d'URL invalide ou
 * d'échec de chargement (`onError`), on retombe proprement sur les initiales —
 * jamais d'image cassée.
 */

/** Une valeur image est-elle affichable ? data-URL image, ou http(s), non vide. */
export function isRenderableImage(url: string | null | undefined): url is string {
  if (!url || typeof url !== 'string') return false;
  const v = url.trim();
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(v) || /^https?:\/\//i.test(v);
}

export function CartItemThumb({ imageUrl, name }: { imageUrl?: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  // Une nouvelle image (autre produit sur la même ligne) réarme le rendu photo.
  useEffect(() => { setFailed(false); }, [imageUrl]);

  if (isRenderableImage(imageUrl) && !failed) {
    return (
      <img
        src={imageUrl}
        alt={name}
        onError={() => setFailed(true)}
        className="product-avatar object-cover flex-shrink-0"
        draggable={false}
      />
    );
  }
  return (
    <div className={`product-avatar bg-gradient-to-br ${avatarColor(name)} flex-shrink-0`}>
      {initials(name)}
    </div>
  );
}
