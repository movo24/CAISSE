# MASTER_ROADMAP.md — POS Caisse The Wesley

> MAJ : 2026-07-02 (P281/v21 — réécrit sur preuves après reprise Fab 5). Source de vérité de la séquence de travail. Détail blocs : `POS_BLOCKS.md`. État détaillé : `STATE_INDEX.md` + `PROJECT_STATUS.md` (jalons v19→v21).

## Vision

POS Caisse = logiciel central The Wesley : caisse magasin, ventes, paiements, employés, stocks, tickets, comptabilité, planning/paie (via TimeWin24 / Paywin24), supervision mobile, intégrations futures. Architecture **cloud-centrée** : postes POS = fenêtres connectées, secours offline/SIM si nécessaire. **POS Caisse reste maître** des ventes, scans, paiements, tickets, sessions, employés, terminaux, magasins ; les systèmes tiers reçoivent des événements et alertent, ils ne commandent pas la caisse.

## Jalons (statuts prouvés — références de preuve entre parenthèses)

| Jalon | Objectif | État |
|---|---|---|
| M0 — Gouvernance & Audit | Fichiers de pilotage + registre de blocs numéroté | ✅ Fait (15 docs racine + EXECUTION_LOG P1→P281) |
| M1 — Intégrité fiscale (NF525) | Hash-chain ventes, immutabilité, idempotence, Z-report figé | ✅ Codé + testé local (fingerprint v2 P25d861, journal annulations, chaîne avoirs, vérificateur `fiscal:verify`, suites sale-m2/void-m4/avoir-m1-m3 vertes) — runtime base cible ⛔ gated |
| M2 — Socle POS desktop | Écrans caisse/panier/paiement/ticket/retour/session | 🟡 Construit (tsc+vite verts, vitest 23 tests, garde remise offline P159) — e2e RUN gated (chromium+seed) |
| M3 — Paiements | Espèces, carte, Stripe Terminal, mixtes, avoir, annulation | 🟡 payment-policy/couverture/avoir/mixte testés ; void-cash gardé (P9da752f) ; Stripe Terminal codé, validation live ⛔ gated (clés) |
| M4 — Stock & Catalogue | Stock/magasin, mouvements, alertes 20 %, anti-doublons | ✅ Testé jusqu'au SQL réel (pg-mem P278 + jumeau .pg décrément) : baseline-20 %, dédup nom, override prix, variance — reste TD-STOCK-TWO-SYSTEMS (arbitrage) |
| M5 — Règles caisse | Sessions `(store_id, terminal_id)`, gardes annulation, **plafond remise 30 %** | ✅ Sessions primitives testées, void cash bloqué, discount-policy 30 % strict + garde pré-vente prouvée SQL (P275) |
| M6 — Employés / Planning / Paie | Binding employé↔session, TimeWin24, **Paywin24 (à créer)** | 🟡 Binding + rôles testés ; TW24 HMAC+mapping testés, live ⛔ gated ; **Paywin24 inexistant** (décision produit) |
| M7 — Comptabilité / pré-compta | Exports ventes/paiements/TVA/caisse, **Comptamax24** | 🟡 Exports CSV locaux + rapprochement testés (P100/102/113-114) ; journal comptable query prouvé (P270) ; envoi réel ⛔ gated OUTBOX ; écritures sociales ⛔ gated décision comptable |
| M8 — Supervision mobile | Cockpit lecture seule, `GET /api/mobile/v1/alerts` | 🟡 Endpoint testé ; mobile vitest 13 tests ; build natif Capacitor ⛔ gated |
| M9 — Durcissement | Sécurité, logs/audit, offline robuste, CI verte | ✅ Local : 7 gardes anti-secret CI (P236-240), anti-XSS receipts verrouillé (P241), tenant-isolation, rejeu offline sans duplication prouvé SQL (P280), CI lint+tests+builds — monitoring runtime ⛔ gated infra |

## Chemin critique restant (ordre)

1. **GATE 1 — Connecteur push réel (OUTBOX)** : `OUTBOX_PUBLISH_URL`+`OUTBOX_PUBLISH_SECRET` → activer `HttpOutboxPublisher` (contrat : `POS_PUSH_CONTRACT.md`).
2. **GATE 2 — Migration 1725 base cible** : `DATABASE_URL` + GO explicite.
3. **GATE 3 — Écritures sociales** : plan de comptes validé comptable.
4. **Runtime de recette** : Postgres jetable → lever PIN-500 (#1) + smoke endpoints + e2e Playwright RUN.
5. **Time-series (Timescale)** : plan préparé (`TIMESCALE_PLAN.md`) — ⛔ aucune activation sans GO spécifique.

## Cadence

Paquets de **5 blocs max**. Après chaque paquet : tests adaptés → MAJ `.md` → commit local → rapport → paquet suivant automatique (sauf blocage réel défini dans `EXECUTION_LOG.md`). Zéro push distant, zéro secret, zéro action prod sans GO.
