/**
 * Vignette panier — décision « afficher la vraie photo » vs « avatar initiales ».
 * P0 : « CHARBON BLACK COCO » montrait le carré initiales « CB » faute d'image.
 */
import { describe, it, expect } from 'vitest';
import { isRenderableImage } from './CartItemThumb';

describe('isRenderableImage', () => {
  it('data-URL image persistée (base products.image_url) → affichable', () => {
    expect(isRenderableImage('data:image/jpeg;base64,/9j/4AAQSkZJRг==')).toBe(true);
    expect(isRenderableImage('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
    expect(isRenderableImage('data:image/webp;base64,UklGR... ')).toBe(true);
  });

  it('URL http(s) → affichable', () => {
    expect(isRenderableImage('https://cdn.example.com/p.jpg')).toBe(true);
    expect(isRenderableImage('http://localhost:3001/img/p.png')).toBe(true);
  });

  it('vide / null / undefined / non-image → repli initiales (jamais d\'image cassée)', () => {
    expect(isRenderableImage(null)).toBe(false);
    expect(isRenderableImage(undefined)).toBe(false);
    expect(isRenderableImage('')).toBe(false);
    expect(isRenderableImage('   ')).toBe(false);
    expect(isRenderableImage('CB')).toBe(false);
    expect(isRenderableImage('data:text/plain;base64,SGk=')).toBe(false); // pas une image
    expect(isRenderableImage('/relative/path.jpg')).toBe(false); // ni data ni http → repli sûr
  });
});
