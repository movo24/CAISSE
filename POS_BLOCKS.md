# POS_BLOCKS.md — Registre numéroté des blocs (vérifié 2026-06-28)

> Statut : ✅ Fait · 🔄 En cours · ⬜ À faire · ⚠️ À vérifier · ⛔ Bloqué réel
> Priorité : P0 (intégrité/sécurité/caisse) · P1 (cœur métier) · P2 (confort) · P3 (futur)
> **Honnêteté** : "⚠️ À vérifier" = le code existe mais n'est pas prouvé branché/testé ici. Aucun bloc n'est ✅ sans preuve (commit + test vert).

## Gouvernance (PAQUET 1 — en cours)

| # | Titre | Statut | Prio | Fichiers/preuve | Dépend. |
|---|---|---|---|---|---|
| POS-001 | Audit global read-only | ✅ | P0 | `PROJECT_STATUS.md` (faits vérifiés) | — |
| POS-002 | 12 fichiers de pilotage | 🔄 | P0 | les 12 `.md` racine | 001 |
| POS-003 | Registre des blocs numéroté | 🔄 | P0 | ce fichier | 001 |
| POS-004 | Aligner CLAUDE.md sur le réel (drift) | ⬜ | P1 | `CLAUDE.md` vs audit | 001 |
| POS-005 | EXECUTION_LOG + cadence paquets | 🔄 | P0 | `EXECUTION_LOG.md` | 002 |

## Socle POS desktop

| # | Titre | Statut | Prio | Localisation | Critère d'acceptation |
|---|---|---|---|---|---|
| POS-010 | App desktop Electron + dual-window | ⚠️ | P0 | `pos-desktop/src/main/*`, `ClientDisplayPage` | Lance POS + écran client |
| POS-011 | Écran caisse principal | ⚠️ | P0 | `POSPage.tsx`, `components/pos`, `ipad` | Saisie articles OK |
| POS-012 | Écran panier | ⚠️ | P0 | `useCart.ts`, layout | Ajout/retrait/qté |
| POS-013 | Écran paiement | ⚠️ | P0 | `usePayment.ts` | Choix moyen + validation |
| POS-014 | Écran/édition ticket | ⚠️ | P0 | `receipts`, `useBluetoothPrinter` | Ticket émis après paiement |
| POS-015 | Écran retour / annulation | ⚠️ | P0 | `ReturnModal.tsx`, `returns` | Avoir généré, NF525 OK |
| POS-016 | Ouverture / fermeture caisse | ⚠️ | P0 | `pos-session`, `z-report` | Session ouverte/fermée |
| POS-017 | Comptage espèces (midi + fermeture) | ⚠️ | P1 | à localiser | Comptage tracé |
| POS-018 | Historique ventes | ⚠️ | P1 | `GET /api/sales` | Liste filtrable |
| POS-019 | Paramètres terminal | ⚠️ | P2 | `terminals`, `useDeviceProfile` | Config persistée |
| POS-020 | État connexion / mode dégradé | ⚠️ | P0 | `useOfflineMode`, `offlineStore` | Bascule offline visible |

## Matériel caisse

| # | Titre | Statut | Prio | Localisation |
|---|---|---|---|---|
| POS-030 | Scanner code-barres | ⚠️ | P1 | `useScannerZXing`, `useBluetoothScanner` |
| POS-031 | Imprimante ESC/POS | ⚠️ | P1 | `useBluetoothPrinter` |
| POS-032 | Lecteur QR | ⚠️ | P2 | ZXing |
| POS-033 | TPE Stripe Terminal WisePad 3 | ⚠️ | P0 | `useStripeTerminal`, backend `stripe-terminal` |
| POS-034 | Passerelle mobile paiement iOS/Android | ⬜ | P2 | à définir |
| POS-035 | Gestion erreurs périphériques + reconnexion | ⚠️ | P1 | hooks HW |
| POS-036 | Réimpression ticket | ⚠️ | P2 | `receipts` |
| POS-037 | Tests matériel simulé (mocks) | ⬜ | P1 | à créer |

## Paiements

| # | Titre | Statut | Prio | Localisation |
|---|---|---|---|---|
| POS-040 | Espèces | ⚠️ | P0 | `sale-payment` |
| POS-041 | Carte / Stripe Terminal | ⚠️ | P0 | `stripe-terminal` |
| POS-042 | Paiement différé/offline carte | ⬜ | P1 | `POS_PAYMENT_STRATEGY.md` |
| POS-043 | Store credit / avoir | ⚠️ | P1 | `returns`, `credit-note*` |
| POS-044 | Paiements mixtes | ⚠️ | P1 | `sale-payment` (multi) |
| POS-045 | Annulation paiement | ⚠️ | P0 | garde commit `9da752f` |
| POS-046 | Remboursement | ⚠️ | P1 | `returns` |
| POS-047 | Idempotence stricte (double paiement interdit) | ⚠️ | P0 | `idempotency-key`, `sales.service` |
| POS-048 | Cohérence paiement = total avant finalisation | ⚠️ | P0 | `sales.service` |
| POS-049 | Synchro paiement cloud | ⚠️ | P1 | `sync` |

## Règles caisse

| # | Titre | Statut | Prio | Localisation |
|---|---|---|---|---|
| POS-050 | Sessions liées `(store_id, terminal_id)` | ⚠️ | P0 | `pos-session`, migration `1719...TerminalId` |
| POS-051 | Interdiction doublons sessions/ventes | ⚠️ | P0 | `idempotency-key` |
| POS-052 | Garde annulation espèces | ✅(commit) ⚠️(test) | P0 | commit `9da752f` |
| POS-053 | Remises internes interdites sauf code responsable | ⬜ | P1 | `sales-guards` |
| POS-054 | Plafond remise responsable 30% max | ⬜ | P0 | `sales-guards` |
| POS-055 | Jours fériés paramétrables + quiet hours alertes | ⚠️ | P2 | `shift-reminders` |
| POS-056 | Audit log actions sensibles, aucune suppression silencieuse | ⚠️ | P0 | `audit`, `fiscal` |

## Produits / catalogue

| # | Titre | Statut | Prio | Localisation |
|---|---|---|---|---|
| POS-060 | Produit parent + variantes/SKU | ⚠️ | P1 | `product`, `product-*` |
| POS-061 | Prix par magasin + override | ⚠️ | P1 | `product-store-availability`, `price-history` |
| POS-062 | Marque / fournisseur / catégories / images | ⚠️ | P2 | `product-category`, `product` |
| POS-063 | TVA / prix TTC | ⚠️ | P0 | `product`, money utils |
| POS-064 | Statut actif/inactif | ⚠️ | P2 | `product` |
| POS-065 | Import/export catalogue | ⚠️ | P2 | `products` (export à vérifier) |
| POS-066 | Anti-doublons SKU/EAN/nom normalisé | ⬜ | P1 | à implémenter/vérifier |

## Promotions / remises

| # | Titre | Statut | Prio | Localisation |
|---|---|---|---|---|
| POS-070 | Codes promo + fenêtre validité | ⚠️ | P1 | `promotions`, `promo-rule`, `coupon` |
| POS-071 | Limite d'usage + scope magasin/produit/cat | ⚠️ | P1 | `promo-rule` |
| POS-072 | Traçabilité usage | ⚠️ | P1 | `coupon` |
| POS-073 | Refus auto (expirée / plafond / doublon) | ⚠️ | P0 | `coupon` idempotency |

## Stock

| # | Titre | Statut | Prio | Localisation |
|---|---|---|---|---|
| POS-080 | Stock par magasin | ⚠️ | P0 | `stock-balance` |
| POS-081 | Mouvement stock à chaque vente | ⚠️ | P0 | `stock-movement`, `sales.service` |
| POS-082 | Retour stock si annulation/remboursement | ⚠️ | P0 | `returns`, `stock` |
| POS-083 | Alerte stock bas (seuil 20%) + message responsable | ⬜ | P1 | `stock`, `notifications` |
| POS-084 | Vérif physique obligatoire avant correction + trace | ⚠️ | P1 | `inventory-scan` |
| POS-085 | Inventaire / écart stock | ⚠️ | P1 | `inventory-scan`, `InventoryVariancePage` (non commité) |
| POS-086 | Synchro stock cloud + cohérence offline/online | ⬜ | P1 | `sync` |

## Employés / planning / paie

| # | Titre | Statut | Prio | Localisation |
|---|---|---|---|---|
| POS-090 | Employés / rôles / permissions | ⚠️ | P0 | `employees`, `roles.guard` |
| POS-091 | Binding employé ↔ session POS | ⚠️ | P0 | `pos-session`, `employee-store-access` |
| POS-092 | TimeWin24 planning | ⚠️ | P1 | `timewin` |
| POS-093 | Paywin24 paie (heures travaillées) | ⛔ | P1 | aucune réf code — à créer |
| POS-094 | Ventes par employé + actions sensibles tracées | ⚠️ | P1 | `audit`, `sales` |

## Comptabilité / pré-compta

| # | Titre | Statut | Prio | Localisation |
|---|---|---|---|---|
| POS-100 | Exports ventes/paiements/TVA/caisse/espèces/remboursements | ⬜ | P1 | `reports` (partiel) |
| POS-101 | Comptamax24 (API/événement) | ⛔ | P1 | aucune réf code — à créer |
| POS-102 | Rapprochement paiements + pièces justificatives | ⬜ | P1 | à créer |

## Supervision mobile

| # | Titre | Statut | Prio | Localisation |
|---|---|---|---|---|
| POS-110 | Cockpit mobile lecture seule | ⬜ | P1 | `packages/mobile` |
| POS-111 | `GET /api/mobile/v1/alerts` | ⛔ | P1 | inexistant — à créer |
| POS-112 | Alertes (caisse/stock/paiement/fermeture/anomalies) | ⬜ | P1 | `notifications`, `sale-anomaly-log` |
| POS-113 | Aucune action dangereuse depuis mobile | ⬜ | P0 | RBAC mobile |

## Intégrité fiscale / NF525 (transverse P0)

| # | Titre | Statut | Prio | Localisation |
|---|---|---|---|---|
| POS-120 | Hash-chain ventes (fingerprint v2) | ⚠️ | P0 | `fiscal`, commits M2 `25d0861` |
| POS-121 | Immutabilité vente validée (no UPDATE) | ⚠️ | P0 | `sales`, `audit` |
| POS-122 | Z-report figé | ⚠️ | P0 | `z-report` |
| POS-123 | Journal fiscal append-only annulations | ⚠️ | P0 | `fiscal-journal`, commit M4 `6b48e9b` |
| POS-124 | Vérificateur de chaîne fiscale | ⚠️ | P0 | `npm run fiscal:verify` (commit `f5eb4d7`) |

## Sécurité (transverse — voir POS_SECURITY.md)

| # | Titre | Statut | Prio |
|---|---|---|---|
| POS-130 | PIN login prod 500 | ⚠️ | P0 |
| POS-131 | Secrets dans historique git | ⚠️ | P0 |
| POS-132 | Receipts auth + anti-XSS | ⚠️ | P0 |
| POS-133 | Erreurs front non avalées | ⚠️ | P1 |

---

## Sélection PAQUET 1 (en cours)

POS-001, POS-002, POS-003, POS-004, POS-005 — gouvernance & alignement, **non dangereux, réversible, testable** (lint/build sur doc = n/a, pas de code métier modifié). Voir `EXECUTION_LOG.md`.

## PAQUET 2 (proposé — démarrage automatique après commit P1)

POS-047 (idempotence), POS-048 (cohérence paiement=total), POS-052/054 (gardes remise/annulation), POS-120 (hash-chain) — **vérification par tests ciblés** des invariants P0 déjà codés, sans modification de comportement tant que les tests passent.
