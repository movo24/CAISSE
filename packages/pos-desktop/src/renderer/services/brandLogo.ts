/**
 * Logo officiel The Wesley pour le TICKET PAPIER — embarqué en data-URL AU BUILD.
 *
 * Pourquoi cette forme (correctif prod 2026-07-24) :
 *  - Le ticket réel est sérialisé en HTML autonome puis imprimé par le main dans
 *    une fenêtre `data:text/html` isolée (voir main/posPrinting.ts). Dans cette
 *    fenêtre, SEULE une image en `data:image/...;base64` s'affiche : une URL
 *    relative/`app://`/`https://` ne résout pas (origine `data:`, ou pas encore
 *    chargée au moment du `print()`). Le logo DOIT donc être une data-URL.
 *  - L'ancienne version récupérait l'asset par `fetch()` au runtime (préchargement
 *    async). En build packagé (protocole `app://`, asset haché séparé) ce fetch
 *    est fragile et, s'il n'a pas abouti, `getBrandLogoDataUrl()` renvoyait `null`
 *    → ticket sans logo, silencieusement. On supprime tout le runtime : le logo
 *    est une CONSTANTE data-URL du code (`wesleyReceiptLogo.ts`), donc dans le
 *    bundle JS, disponible SYNCHRONEMENT — indépendant de Vite/`app://`/fetch.
 *
 * Source de vérité du logo du ticket : la config magasin du Dashboard
 * (`receiptLogoUrl`) SI elle est une data-URL imprimable ; sinon ce logo officiel
 * embarqué. Un `receiptLogoUrl` non conforme ne doit JAMAIS aboutir à « pas de
 * logo » : il est ignoré au profit du repli embarqué.
 */
import { WESLEY_RECEIPT_LOGO_DATA_URL as officialLogoDataUrl } from '../assets/wesleyReceiptLogo';

/**
 * Une image n'est imprimable dans la fenêtre `data:text/html` que si c'est une
 * data-URL PNG/JPEG en base64 (même contrat que le rendu dans peripheralBridge).
 */
export function isPrintableLogoDataUrl(value: unknown): value is string {
  return typeof value === 'string' && /^data:image\/(png|jpe?g);base64,/.test(value);
}

/** Data-URL du logo officiel embarqué (garanti valide, disponible sans I/O). */
export function getBrandLogoDataUrl(): string | null {
  return isPrintableLogoDataUrl(officialLogoDataUrl) ? officialLogoDataUrl : null;
}

/**
 * Logo à imprimer sur le ticket : la config magasin si (et seulement si) c'est
 * une data-URL imprimable, sinon le logo officiel embarqué. Ne renvoie jamais
 * une valeur non imprimable (qui produirait un ticket sans logo).
 */
export function resolveReceiptLogo(configuredLogo?: string | null): string | null {
  if (isPrintableLogoDataUrl(configuredLogo)) return configuredLogo;
  return getBrandLogoDataUrl();
}
