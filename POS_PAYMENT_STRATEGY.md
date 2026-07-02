# POS_PAYMENT_STRATEGY.md — Stratégie paiements (vérifié 2026-06-28)

> Architecture cloud-centrée. Aucun paiement réel n'a été exécuté pendant l'audit (interdit).

## Moyens de paiement attendus

espèces · carte · Stripe Terminal WisePad 3 · paiement différé/offline carte · store credit / avoir · paiements mixtes · annulation · remboursement.

## Existant (vérifié)

- Backend `modules/stripe-terminal/` (controller + service + spec).
- Backend `modules/terminals/` (registre terminaux physiques).
- Entité `sale-payment` (multi-paiements par vente → paiements mixtes possibles au modèle).
- POS hooks `useStripeTerminal.ts`, `usePayment.ts`.
- Avoir / store credit : `modules/returns`, entités `credit-note(+line/redemption)`, refs idempotency dans `returns.service.ts`.
- Garde anti-annulation espèces réalisées : commit `9da752f`.

## Règles (NF525 / intégrité)

1. **Idempotence obligatoire** sur toute écriture monétaire (création vente, capture, émission ticket, sync, redemption avoir). Réutiliser/rejeter une clé déjà traitée ; rejet 409 si même clé + params différents.
2. **Double paiement interdit.**
3. Vente finalisée uniquement si cohérence paiement (somme paiements = total).
4. Annulation/remboursement → jamais d'UPDATE sur vente validée ; passer par avoir / contre-écriture / événement append-only.
5. Statut paiement tracé + synchro cloud.
6. Erreurs TPE gérées + reconnexion.

## À prouver / à créer

- Paiements mixtes : flux UI complet à vérifier (modèle OK, UX à prouver).
- Paiement carte hors-ligne (différé) : **STRATÉGIE DÉCIDÉE (P352)** —
  ① voie nominale offline = TPE autonome SIM/4G (capture réelle, vente finalisée normalement, sync existante) ;
  ② « différé » = FILE DE CAPTURE, jamais une vente finalisée sans encaissement (règle 3) : vente EN ATTENTE hors chaîne fiscale + ordre de capture idempotent (clé déterministe `defcap:<saleClientId>:<montant>`) dans la file offline ; au retour réseau : captured→finalisation idempotente · declined→vente abandonnée (n'a jamais existé fiscalement), re-encaissement · error→retry ;
  ③ garde-fous : 150 €/ticket différé, 500 € d'encours (défauts ajustables).
  Moteur pur livré+testé : `pos-desktop/src/renderer/lib/deferred-card-policy.ts` (**12/12**). Restant : exécuteur de capture au retour réseau (stripe-terminal) + UI usePayment → `TD-042-EXECUTOR` (nécessite TPE réel).
- Tests paiement simulé (mock TPE) : à étendre. Dette `TD-PAYMENT-TESTS`.
- Réconciliation paiements ↔ compta (Comptamax24) : ⛔ non branché.
