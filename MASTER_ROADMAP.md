# MASTER_ROADMAP.md — POS Caisse The Wesley

> MAJ : 2026-06-28. Source de vérité de la séquence de travail. Détail blocs : `POS_BLOCKS.md`.

## Vision

POS Caisse = logiciel central The Wesley : caisse magasin, ventes, paiements, employés, stocks, tickets, comptabilité, planning/paie (via TimeWin24 / Paywin24), supervision mobile, intégrations futures. Architecture **cloud-centrée** : postes POS = fenêtres connectées, secours offline/SIM si nécessaire.

## Jalons

| Jalon | Objectif | État |
|---|---|---|
| M0 — Gouvernance & Audit | 12 fichiers de pilotage + registre de blocs numéroté | 🔄 En cours (ce paquet) |
| M1 — Intégrité fiscale (NF525) | Hash-chain ventes, immutabilité, idempotence, Z-report figé | ⚠️ Largement codé (modules `fiscal`, `audit`, `sales`) — à re-prouver par tests verts complets |
| M2 — Socle POS desktop | Écrans caisse/panier/paiement/ticket/retour/ouverture-fermeture/comptage | ⚠️ Présent (POSPage + composants) — couverture écran par écran à prouver |
| M3 — Paiements | Espèces, carte, Stripe Terminal, mixtes, avoir, annulation, remboursement | ⚠️ Partiel — Stripe Terminal présent, à valider |
| M4 — Stock & Catalogue | Stock/magasin, mouvements, alertes 20%, anti-doublons SKU/EAN | ⚠️ Modules présents — règles métier à vérifier |
| M5 — Règles caisse | Sessions `(store_id, terminal_id)`, gardes annulation, plafond remise 30% | ⚠️ `pos-session` + `sales-guards` présents — règles à prouver |
| M6 — Employés / Planning / Paie | Binding employé↔session, TimeWin24 planning, **Paywin24 paie (à créer)** | ⛔ Paywin24 non branché |
| M7 — Comptabilité / pré-compta | Exports ventes/paiements/TVA/caisse, **Comptamax24 (à créer)** | ⛔ Comptamax24 non branché |
| M8 — Supervision mobile | Cockpit lecture seule, `GET /api/mobile/v1/alerts` (**à créer**) | ⛔ Endpoint inexistant |
| M9 — Durcissement | Sécurité, logs/audit, offline robuste, tests verts CI | ⬜ À faire |

## Cadence

Paquets de **5 blocs max**. Après chaque paquet : tests adaptés → MAJ `.md` → commit → rapport → paquet suivant automatique (sauf blocage réel défini dans `EXECUTION_LOG.md`).
