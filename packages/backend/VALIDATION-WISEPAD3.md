# VALIDATION WISEPAD 3 + STRIPE PROD — Runbook terrain (GO owner)

> Bloc « GO WisePad 3 + Stripe prod ». Le code est prêt et testé (CI verte) ;
> **cette checklist est la partie qui exige le matériel physique et la clé prod**
> — elle s'exécute par l'owner, hors de l'environnement agent. Aucune étape
> Railway/DNS/rotation/stock/signature ici (hors périmètre du bloc).

---

## 0. Pré-requis (owner uniquement)

- [ ] Un lecteur **WisePad 3** physique, chargé, connecté au même réseau que la caisse.
- [ ] `STRIPE_SECRET_KEY` **prod** (`sk_live_…`) posée **uniquement en variable d'env**
      du backend (Railway → Variables). **Jamais en dur, jamais commitée** —
      `stripe.module.ts` la lit exclusivement depuis `process.env` et logge
      seulement « Stripe features disabled » si absente (aucune valeur loggée).
- [ ] Conseil : valider D'ABORD tout ce runbook avec une clé **test** (`sk_test_…`)
      + le lecteur en mode test, PUIS rejouer les étapes 3–5 en live avec un
      petit montant réel (ex. 1,00 €) remboursé ensuite depuis le dashboard Stripe.

## 1. Enregistrement du lecteur (une fois par device)

1. Sur le WisePad 3 : générer le code d'enregistrement (menu réglages du lecteur).
2. `POST /api/stripe-terminal/readers/register` (admin) avec
   `{ registrationCode, label: "Caisse 1", locationId }`
   (créer la location si besoin : `listLocations` / `createLocation`).
3. Vérifier : `GET /api/stripe-terminal/readers` liste le lecteur `online`.

## 2. Capability gate (déjà automatique — vérifier)

- [ ] `GET /api/stripe-terminal/status` → `{ "configured": true }`.
- [ ] Sur l'iPad POS : le bouton carte lance le vrai flux (plus de mode DÉMO).
- [ ] Contre-épreuve : retirer la clé d'un env de test → bouton carte =
      erreur claire (« terminal non configuré »), aucun overlay.

## 3. Encaissement nominal (le verrou principal)

1. Panier → paiement carte → l'overlay affiche « Présentez la carte sur le lecteur… ».
2. Présenter la carte sur le WisePad 3 → paiement accepté sur le lecteur.
3. **Vérifications de bout en bout :**
   - [ ] Vente créée `status: completed` (backoffice → Ventes) ;
   - [ ] Le leg carte porte `stripePaymentIntentId` (détail de la vente) ;
   - [ ] Logs backend : `[CARD-VERIFY] … PI pi_… verified (succeeded, …)` —
         la capture a été **prouvée côté serveur**, pas crue sur parole ;
   - [ ] Dashboard Stripe : le PaymentIntent est `succeeded`, montant exact,
         `metadata.storeId` = le magasin ;
   - [ ] Ticket : statut d'impression honnête affiché (imprimé / non imprimé) ;
   - [ ] Duplicata : `GET /api/documents/sales/{id}/duplicata` rend le PDF.

## 4. Matrice d'échecs (chaque cas DOIT se comporter comme décrit)

| Cas | Geste | Comportement attendu (codé + testé) |
|-----|-------|--------------------------------------|
| Lecteur absent | Aucun lecteur détecté au 1er paiement | Erreur « Aucun lecteur carte détecté… », pas de vente |
| Lecteur déconnecté | Éteindre le lecteur en cours de collecte | Overlay « refusé » + message lecteur ; retry/espèces/annuler |
| Paiement refusé | Carte de test déclinée (`4000 0000 0000 0002` en mode test) | « Paiement refusé », vente NON créée, panier conservé |
| Timeout client | Ne pas présenter de carte 2 min | Échec propre (timeout), retry possible |
| Annulation | « Annuler » pendant la collecte | `cancelCollect` → le lecteur se réinitialise, aucun débit |
| Double-clic | Marteler « payer » | 1 seul PaymentIntent (verrou `activePaymentRef` + clé PI serveur **déterministe**) |
| Reprise après échec | Refus puis « Réessayer » | Même checkout → même référence → PI dédupliqué côté Stripe |
| Double soumission vente | Rejouer la création (réseau) | `Idempotency-Key` → 1 seule vente (PR #24) |
| Coupure réseau caisse APRÈS capture | Couper le wifi après accord lecteur | Vente en file offline, resync dédupliqué ; leg carte avec PI vérifié au replay |
| **PI falsifié** (sécurité) | POST /sales avec un `stripePaymentIntentId` bidon | **400 refusé** (« PaymentIntent introuvable ») — testé `card-capture-verify.spec.ts` |
| Stripe down au moment de la vente | (simulable en test en coupant l'egress) | Vente `payment_pending` « à régulariser », jamais « payée » à tort |

## 5. Traçabilité (après 3 + un cas de 4)

- [ ] Backoffice → Ventes : la vente carte est `Validée` ; une vente dégradée
      apparaît « À régulariser » avec le leg « NON capturé » visible.
- [ ] `GET /api/sales/pending-payments` liste les ventes à régulariser ;
      `regularize-payment` (manager) les clôt — action auditée.
- [ ] Chaîne d'audit : `sale_completed` porte terminal/session ; empreintes
      fiscales inchangées (`fiscal-verify` reste vert).
- [ ] Aucun secret dans les logs : ni `sk_…`, ni `client_secret` (le backend ne
      logge que des ids `pi_…` et des montants ; vérifié par grep en CI locale).

## 6. Critère de sortie du bloc

Tout coché ⇒ la carte est validée terrain. Alors seulement : bloc suivant de
l'ordre owner (TEST_DATABASE_URL → décision D1.4 → Railway → DNS → secrets →
stock one-shot → signature).

## Limites connues (assumées, hors périmètre du bloc)

- `regularize-payment` (manager) reste une déclaration humaine auditée — il
  n'exige pas de PI (capture hors-bande possible, ex. TPE de secours).
- Le remboursement **carte** ne passe pas par un refund Stripe automatique
  (cohérent avec l'existant — chantier retour carte séparé).
- Devise figée EUR côté PI (V1 France) — reste de D10.
