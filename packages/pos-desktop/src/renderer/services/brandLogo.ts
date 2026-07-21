/**
 * Logo officiel The Wesley embarqué dans la caisse (asset versionné
 * `wesleys-logo-official.png`) — REPLI de marque pour le ticket papier.
 *
 * Source de vérité du logo du ticket : la config magasin du Dashboard
 * (`receiptLogoUrl`). Ce repli embarqué ne sert QUE tant que le magasin n'a
 * pas encore importé son logo : le ticket porte alors le logo officiel de
 * l'enseigne plutôt que rien. Dès que le Dashboard est renseigné, il prime.
 *
 * L'impression HTML passe par une fenêtre `data:text/html` : les URL d'assets
 * relatives n'y résolvent pas → le logo doit être une data-URL. On précharge
 * l'asset au démarrage (fetch → data-URL, une seule fois) et on l'expose en
 * lecture synchrone pour la construction du ticket.
 */
import officialLogoUrl from '../assets/wesleys-logo-official.png';

let cachedDataUrl: string | null = null;
let loading: Promise<void> | null = null;

/** Data-URL du logo officiel embarqué (null tant que le préchargement n'a pas abouti). */
export function getBrandLogoDataUrl(): string | null {
  return cachedDataUrl;
}

/** Précharge le logo embarqué en data-URL (idempotent, jamais bloquant). */
export function preloadBrandLogo(): Promise<void> {
  if (cachedDataUrl) return Promise.resolve();
  if (loading) return loading;
  loading = (async () => {
    try {
      const res = await fetch(officialLogoUrl);
      const blob = await res.blob();
      cachedDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      // Pas de logo embarqué disponible → le ticket s'imprime sans logo
      // (jamais bloquant, jamais de faux succès).
      console.warn('[BRAND_LOGO] préchargement échoué:', e);
      loading = null;
    }
  })();
  return loading;
}

// Préchargement au démarrage du renderer — le logo est prêt bien avant la
// première vente.
preloadBrandLogo();
