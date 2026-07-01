# TIMEWIN24_CONTRACT.md — Contrat d'échange POS Caisse ↔ TimeWin24

> Version 2026-07-02 (bloc A4, P284). Tout ce qui suit est prouvé par le code (`src/modules/timewin/*`, `auth.service.ts`, `shift-reminders`) et ses specs. Rien d'inventé ; les gates sont marquées.

## 0. Principe d'autorité (règle produit, non négociable)

- **POS Caisse est maître** : ventes, scans, paiements, tickets, sessions, terminaux, magasins, et **l'accès effectif à la caisse**.
- **TimeWin24 est la source RH** : identités employés, contrats, planning, pointage, paie.
- **TimeWin24 ne bloque JAMAIS la caisse directement.** Il fournit du contexte et des alertes ; toute conséquence caisse (refus d'ouverture de session, etc.) est décidée par les règles POS locales, avec l'humain responsable en dernier ressort. Si TW24 est injoignable, la caisse continue (fallback local + circuit breaker).

## 1. Authentification employé (flux réel)

- **Local-first** (décision produit, implémentée dans `auth.service.ts`) : le PIN est vérifié d'abord dans la table `employees` locale ; TimeWin24 n'est consulté **qu'en secours** si l'employé est inconnu localement.
- `POS_AUTH_AUTHORITY=timewin` restaure le flux historique TW24-first (fallback local sur erreur TW24).
- Toute erreur TW24 (timeout 10 s, réseau, 5xx) ⇒ bascule locale silencieuse + log — **jamais** de caisse bloquée par une panne TW24.

## 2. Flux POS → TimeWin24 (sortants)

| Flux | Mécanisme | Auth | Preuve |
|---|---|---|---|
| Événements caisse (`sale.completed`, `session.opened/closed`, `stock.alert`, `store.created/updated`, `pointage`, `cashier_metrics`, `staffing_snapshot`) | `POST /api/pos-events/webhook` (`TimewinService.pushEvent`) + header `X-POS-Store-Id` | HMAC POS (`TIMEWIN24_POS_SECRET`+`TIMEWIN24_POS_KEY_ID`, `pos-hmac.ts` testé) sinon Bearer `TIMEWIN24_API_KEY` | `timewin.service.ts` §pushEvent |
| Pointage caisse (badge/PIN à l'ouverture) | `clockIn`/`clockOut(employeeId, storeId, source='pos')` | idem | idem |
| Mise à jour horaires magasin | `updateStoreSchedule` | idem | idem |

En complément : les mêmes faits métier partent dans l'**outbox normalisé** (`POS_PUSH_CONTRACT.md`) — TW24 peut devenir consommateur standard de ce canal (push HMAC ou pull keyset) au lieu du webhook dédié. Décision d'architecture à trancher côté TW24 ; les deux canaux coexistent aujourd'hui.

## 3. Flux TimeWin24 → POS (entrants)

| Flux | Mécanisme | Notes |
|---|---|---|
| Référentiel employés | `syncEmployees(storeId)` → upsert local (`employee-map.ts` : mapping id/rôle/PIN testé) | cache local = fallback auth |
| Contexte employé (contrat, droits) | `getEmployeeContext` | consultatif |
| Planning du jour / paie mensuelle | `getTodayShifts`, `getMonthlyPayroll` (+ `shift-adapter.ts`, `shift-amplitude.ts` testés) | consultatif + rappels |
| Magasins | `fetchStores` → `POST /api/stores/sync` (@Roles admin) | CAISSE reste maître du référentiel magasin local |
| Config magasin | `getStoreConfig` | consultatif |

## 4. Alertes d'anomalie (TW24 alerte, la caisse tranche)

- **Rapprochement présence** (`presence-reconciliation.ts`, pur, testé) : compare temps caisse (sessions POS open→close) vs pointage TW24 par employé/jour. Anomalies typées : `pos_without_timewin`, `timewin_without_pos`, `open_pos_session`, `delta_exceeds_tolerance` (delta signé, tolérance paramétrable).
- Destination des anomalies : cockpit supervision (`GET /api/mobile/v1/alerts`, manager/admin, read-only) + audit — **aucun blocage automatique de session**.
- **Rappels pré-shift** (`shift-reminders`, cron) : SMS/email providers gated par clés ; sans clé = simulation loggée.

## 5. Résilience (prouvée par specs)

- **Circuit breaker** TW24 (`timewin.service.ts`) : CLOSED → OPEN après 3 échecs → HALF_OPEN après 30 s → probe unique. État exposé (`getCircuitState`) + `health-status.ts` (testé).
- Timeout 10 s (`TIMEWIN24_TIMEOUT_MS`).
- Panne TW24 ⇒ auth locale, planning indisponible marqué comme tel, caisse opérationnelle.

## 6. Variables d'environnement

`TIMEWIN24_URL` · `TIMEWIN24_API_KEY` (Bearer) · `TIMEWIN24_POS_SECRET` + `TIMEWIN24_POS_KEY_ID` (HMAC, prioritaire) · `TIMEWIN24_TIMEOUT_MS` · `POS_AUTH_AUTHORITY` (`local` défaut / `timewin`).

## 7. Gates restantes (honnête)

1. **TW24 live non prouvé** : aucune connexion réelle testée depuis le sandbox (gated accès réseau/secrets). Test d'intégration de recette à jouer : health + `pos-feed/stores` + un `pushEvent` (⚠️ si `POST /api/stores/sync` rend `total: 0` → vérifier `TIMEWIN24_POS_SECRET`/`API_KEY` sur Railway, cf. CLAUDE.md).
2. **Décision canal** : webhook dédié §2 vs consommateur outbox standard — à trancher avec l'équipe TW24.
3. **Paywin24** (paie) : inexistant — décision produit avant tout code.
