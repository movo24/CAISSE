/**
 * QR code du ticket numérique — côté caisse.
 *
 * L'URL scannée est https://<base>/ticket/<jeton> où :
 *  - <base> vient UNIQUEMENT de la config magasin (Dashboard,
 *    receiptPublicBaseUrl) — jamais de domaine codé en dur ici ;
 *  - <jeton> est le jeton public opaque généré par le serveur à la vente
 *    (jamais l'id interne, jamais une donnée client).
 *
 * Hors ligne : pas de jeton tant que la vente n'est pas synchronisée →
 * buildTicketUrl renvoie null et le ticket porte une note claire à la place
 * du QR. L'encaissement n'est JAMAIS bloqué par le ticket numérique.
 */
import QRCode from 'qrcode';

export function buildTicketUrl(
  baseUrl: string | null | undefined,
  publicToken: string | null | undefined,
): string | null {
  if (!baseUrl || !publicToken) return null;
  if (!/^https?:\/\//.test(baseUrl)) return null;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(publicToken)) return null;
  return `${baseUrl.replace(/\/+$/, '')}/ticket/${publicToken}`;
}

/** Génère le QR en data-URL PNG (N&B, marge fine) pour le ticket HTML. */
export async function makeTicketQrDataUrl(url: string): Promise<string | null> {
  try {
    return await QRCode.toDataURL(url, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 220,
      color: { dark: '#000000', light: '#FFFFFF' },
    });
  } catch (e) {
    console.warn('[TICKET_QR] Génération QR échouée:', e);
    return null;
  }
}
