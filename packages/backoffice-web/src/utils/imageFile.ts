/**
 * Validation + compression client d'une photo produit avant stockage en
 * data-URL (architecture existante : colonne text `products.image_url`).
 *
 * Pourquoi : le POST/PUT produit transporte l'image dans le JSON. Un fichier
 * appareil-photo (2–8 Mo) dépassait la limite serveur → échec d'enregistrement.
 * On borne donc la photo côté client : réduction à MAX_DIMENSION px et
 * ré-encodage, avec baisse de qualité progressive jusqu'à MAX_ENCODED_BYTES.
 */

export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_SOURCE_BYTES = 8 * 1024 * 1024; // fichier source refusé au-delà
export const MAX_DIMENSION = 1200; // px, côté le plus long
export const MAX_ENCODED_BYTES = 500 * 1024; // cible après compression

export type ImagePrepResult =
  | { ok: true; dataUrl: string; bytes: number }
  | { ok: false; error: string };

export function validateImageFile(file: File): string | null {
  const type = (file.type || '').toLowerCase();
  if (!ACCEPTED_TYPES.includes(type)) {
    return 'Format non pris en charge — utilisez JPG, PNG ou WebP.';
  }
  if (file.size > MAX_SOURCE_BYTES) {
    return `Fichier trop volumineux (${(file.size / 1024 / 1024).toFixed(1)} Mo) — maximum 8 Mo.`;
  }
  return null;
}

/** Taille réelle (octets) d'une data-URL base64. */
export function dataUrlBytes(dataUrl: string): number {
  const i = dataUrl.indexOf(',');
  const b64 = i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
  return Math.floor((b64.length * 3) / 4);
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible ou corrompue.')); };
    img.src = url;
  });
}

/**
 * Valide puis prépare le fichier : redimensionne (≤ MAX_DIMENSION) et encode en
 * JPEG avec qualité dégressive jusqu'à tenir dans MAX_ENCODED_BYTES.
 * Un PNG/WebP déjà petit et dans les dimensions est conservé tel quel
 * (préserve la transparence des logos).
 */
export async function prepareProductImage(file: File): Promise<ImagePrepResult> {
  const invalid = validateImageFile(file);
  if (invalid) return { ok: false, error: invalid };

  let img: HTMLImageElement;
  try {
    img = await loadImage(file);
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Image illisible.' };
  }

  const within = Math.max(img.naturalWidth, img.naturalHeight) <= MAX_DIMENSION;
  if (within && file.size <= MAX_ENCODED_BYTES && file.type !== 'image/webp') {
    // Conservation à l'identique (le webp est ré-encodé en JPEG pour
    // compatibilité impression ticket / anciens webviews caisse).
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = () => reject(new Error('read'));
      r.readAsDataURL(file);
    }).catch(() => '');
    if (dataUrl) return { ok: true, dataUrl, bytes: file.size };
  }

  const scale = Math.min(1, MAX_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { ok: false, error: 'Canvas indisponible dans ce navigateur.' };
  // Fond blanc : évite le noir sur les PNG transparents ré-encodés en JPEG.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  for (const quality of [0.85, 0.7, 0.55, 0.4]) {
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const bytes = dataUrlBytes(dataUrl);
    if (bytes <= MAX_ENCODED_BYTES) return { ok: true, dataUrl, bytes };
  }
  return {
    ok: false,
    error: 'Impossible de compresser cette image sous la taille maximale — choisissez une image plus simple ou plus petite.',
  };
}
