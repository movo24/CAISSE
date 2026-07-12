/**
 * Douchette « keyboard wedge » globale (POS desktop / mini-PC Windows).
 *
 * Le listener bas-niveau (`peripheralBridge.startBarcodeListener`) capte un scan
 * même quand le champ de recherche n'a PAS le focus (il ignore les scans tapés
 * DANS un input/textarea, où le champ gère lui-même la touche Entrée). Ce
 * helper décide si un scan capté globalement doit être routé vers le panier :
 * on l'accepte uniquement quand la caisse est en état « achat » — jamais
 * pendant une modale qui ne doit pas recevoir un code produit (paiement,
 * confirmation de vente, produit inconnu, saisie de poids, envoi e-mail), ni
 * sans caissier actif.
 *
 * Un scan « avalé » par un input reste géré par le champ lui-même (Entrée →
 * handleScan) : les deux chemins sont mutuellement exclusifs, donc jamais de
 * double ajout.
 */
export interface WedgeScanUiState {
  hasActiveCashier: boolean;
  paymentModalOpen: boolean;
  confirmationOpen: boolean;
  unknownProductOpen: boolean;
  weightModalOpen: boolean;
  emailModalOpen: boolean;
}

/** Un scan wedge global doit-il être routé vers le panier ? */
export function shouldAcceptWedgeScan(s: WedgeScanUiState): boolean {
  return (
    s.hasActiveCashier &&
    !s.paymentModalOpen &&
    !s.confirmationOpen &&
    !s.unknownProductOpen &&
    !s.weightModalOpen &&
    !s.emailModalOpen
  );
}
