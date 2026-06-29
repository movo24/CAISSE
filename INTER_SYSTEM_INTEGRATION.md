# INTER_SYSTEM_INTEGRATION.md — POS Caisse ↔ Comptamax24 ↔ TimeWin24 (+ Analytik R ready)

> Périmètre GO (2026-06-29) : brancher proprement POS ↔ Comptamax24 ↔ TimeWin24, et **préparer** la
> consommation future par **Analytik R** (consommateur, jamais bloqueur de caisse).
> Règle d'or : la caisse reste **stable, non bloquante, testable**. Aucun nouveau système n'est une dépendance dure.

---

## A. AUDIT RÉEL (lecture seule, 2026-06-29)

### Ce qui existe et est branché
| Brique | État | Localisation / preuve |
|---|---|---|
| TimeWin24 — client HTTP riche | 🟡 présent | `timewin.service.ts` : `loginEmployee`, `getEmployeeContext`, `syncEmployees`, `getTodayShifts`, `getMonthlyPayroll`, `getStoreSchedule`, `clockIn/clockOut`, **`pushEvent`** (POS→TW24 webhook), `isHealthy`, circuit breaker. HMAC `pos-hmac` (testé 5/5), mapping `employee-map` (3/3). |
| TimeWin24 — auth source of truth | 🟡 | `auth.service` : TW24 first → fallback local. `upstream-status` (3/3). |
| Comptamax24 — export comptable | 🟦 **local only** | `reports/accounting-export.ts` (`buildDailyAccountingExport` + `toAccountingCsv`) exposé `GET /reports/accounting-export?format=csv\|json`. **Aucun envoi externe, aucune écriture débit/crédit.** |
| Z-report / clôture | ✅ pur+testé | `z-report-aggregate` (immutable), `payments-breakdown` (POS-102). |
| Événements temps réel | 🟦 **éphémère** | `common/realtime/realtime.service.ts` (`emit(storeId,event,data)` via Redis pub/sub). `sales.service` émet `sale.completed` — **non persisté**, perdu si pas de consommateur connecté. |
| Tenant | 🟡 partiel | `sale.entity` = `storeId` seul (pas d'`organizationId`/`unitId`). `store.entity` porte `organizationId`/`unitId`. `TenantInterceptor` filtre par `storeId`. |
| Audit fiscal | ✅ | `audit-hash`, `fiscal/chain-linkage` (NF525). |

### Ce qui manque réellement (gaps bloquant l'intégration propre)
1. **Pas d'outbox durable.** Les events POS sont éphémères (RealtimeService). Comptamax24 et Analytik R ne peuvent pas consommer de façon fiable, rejouable, ordonnée. → **fondation manquante n°1.**
2. **Pas de pré-compta.** `accounting-export` agrège des totaux mais ne produit **pas d'écritures** (compte vente, comptes TVA par taux, compte d'encaissement par moyen de paiement, avoirs). → Comptamax24 ne reçoit rien d'exploitable comptablement.
3. **POS→TimeWin partiel.** `pushEvent` existe mais n'est pas appelé pour `session.opened/closed`, ni pour le **rapprochement temps travaillé vs présence caisse**.
4. **TimeWin→Comptamax inexistant.** Aucune passerelle variables RH (heures, absences, retards) → pré-compta sociale.
5. **Identifiants inter-logiciels non normalisés.** Pas d'enveloppe commune `{tenant, aggregate, type, occurredAt, schemaVersion}` partagée.

### Ce qui est simulé / non prouvé
- Connectivité live TW24 / Stripe : non testée en sandbox (pas de réseau prod, pas de secrets).
- Migrations : non rejouées (pas de DB sandbox).

---

## B. PAQUETS UTILES (numérotés, valeur réelle — aucun cosmétique)

| # | Paquet | Valeur | Risque |
|---|---|---|---|
| 71 | **Outbox d'intégration (fondation)** : enveloppe normalisée + entité append-only + migration additive | branchement manquant + cohérence + Analytik-R-ready | nul (additif) |
| 72 | Émission events vente (transactional outbox) : `sale.completed` + `payment.captured` | traçabilité, automatisation compta, Analytik | faible (non bloquant) |
| 73 | Events retours/avoirs + clôture caisse (`refund`, `creditnote`, `cashsession.closed`) | conformité fiscale | faible |
| 74 | Pré-compta Comptamax : mapper pur écritures (débit/crédit, comptes TVA/vente/encaissement) | automatisation comptable | faible (pur) |
| 75 | Rapprochement POS↔TimeWin : session caisse vs présence/pointage | réduction erreurs RH, conformité | faible (pur) |
| 76 | Consolidation + doc archi | traçabilité | nul |
| 77+ | TimeWin→Comptamax (variables RH→pré-compta sociale), exports justificatifs, vues Analytik | conformité RH | faible |

---

## C/E. ARCHITECTURE CIBLE — Outbox normalisé (le pivot)

```
                 ┌──────────────────────── POS Caisse (source de vérité ventes/caisse) ───────────────────────┐
                 │  createSale / refund / cashSession.close / stock / employee-activity                        │
                 │        │  (dans la MÊME transaction DB — transactional outbox, non bloquant)                │
                 │        ▼                                                                                     │
                 │   integration_events (append-only)   ← enveloppe normalisée, versionnée, tenant-scoped       │
                 └────────┬───────────────────────────────────────────────────────────────────────────────────┘
                          │ (lecture/poll/relais — JAMAIS dans le chemin critique caisse)
        ┌─────────────────┼──────────────────────────────────┬───────────────────────────────┐
        ▼                 ▼                                  ▼                               ▼
   Comptamax24       TimeWin24                          Analytik R (futur)            Back-office / BI
 (pré-compta:      (rapprochement présence            (consomme events ventes,
  écritures TVA,    ↔ sessions caisse;                 stocks, tickets, remises,
  vente, encaiss.,  variables RH→compta)               paiements, ruptures…)
  avoirs)
```

### Contrat d'enveloppe (stable, `schemaVersion`) — consommable par tous
```jsonc
{
  "id": "uuid",
  "type": "sale.completed",          // namespacé: <aggregate>.<action>
  "aggregateType": "sale",
  "aggregateId": "uuid",
  "occurredAt": "ISO-8601",
  "tenant": { "organizationId": "uuid|null", "storeId": "...", "terminalId": "...|null" },
  "actor":  { "employeeId": "...|null", "role": "...|null" },
  "payload": { /* données métier figées, intégers centimes */ },
  "schemaVersion": 1,
  "source": "pos-caisse"
}
```

### Règles d'architecture Analytik-R-ready (imposées dès maintenant)
- **Toute** donnée utile (ventes, stocks, tickets, employés, horaires, remises, paiements, ruptures, events magasin) passe par une enveloppe outbox normalisée → Analytik R consomme **sans modifier POS**.
- Montants toujours en **entiers centimes** ; dates **ISO-8601** ; identifiants cohérents (`storeId`, `organizationId`, `aggregateId`).
- L'outbox est **append-only** (pas d'UPDATE/DELETE métier ; statut de relais séparé).
- L'écriture de l'event est **dans la transaction** de l'agrégat (cohérence) mais sa **publication** est hors chemin critique (poll/relai) → la caisse ne dépend jamais de Comptamax/TimeWin/Analytik disponibles.

---

## D. PREUVES (mises à jour par paquet dans EXECUTION_LOG.md)
Chaque paquet : objectif · fichiers · test · typecheck/build · git · dette · paquet suivant.

---

## F. ÉTAT D'AVANCEMENT (2026-06-29)

| Paquet | Livré | Preuve |
|---|---|---|
| 71 | Outbox fondation (enveloppe + entité append-only + migration 1725 additive) | 6/6, tsc 0 |
| 72 | `sale.completed` + `payment.captured` dans la **tx de vente** (transactional outbox) | 11/11, build RC=0 |
| 73 | `refund.created` / `credit_note.issued` (returns + gift) + `cash_session.closed` (Z, atomique) | 4/4, tsc 0 |
| 74 | **Comptamax pré-compta** : moteur écritures équilibrées (PCG) + `GET /comptamax/journal` (csv/json, tenant, anti-IDOR) lisant l'outbox | 9/9, build RC=0 |
| 75 | **POS↔TimeWin** rapprochement présence (moteur pur) + `employee_activity.recorded` (open/close caisse, best-effort) | 12/12, build RC=0 |
| 76 | **TimeWin→Comptamax** prépa variables RH (heures/absences/retards + CSV justificatif) | 5/5, tsc 0 |
| 77 | Consolidation : agrégat **8 suites / 41 tests** intégration, tsc 0, doc | — |

**Flux branché de bout en bout (local) :** vente/retour/clôture caisse → **outbox** `integration_events` (atomique) → `GET /api/comptamax/journal` produit le **journal comptable équilibré** (débit=crédit) jour/magasin en CSV/JSON. Activité employé (sessions) → outbox → moteur de **rapprochement présence** prêt à brancher sur TimeWin.

### Dette / gates documentés (non franchis sans décision)
- `TD-INT-ORG` : `organizationId` non porté par sale/cn/session → `null` (consommateur résout via store).
- `TD-INT-TERMINAL` : terminalId non threadé dans `createSale` (présent sur pos-session).
- `TD-INT-REFUND-TAX` : split TVA de l'avoir non porté dans le payload → écriture avoir en HT=total (TVA 0) tant que non fourni.
- `TD-INT-RELAY` : **relais/poller** outbox → envoi réel Comptamax24/TimeWin24 non implémenté (secrets + endpoints distants = hors sandbox). L'outbox est prêt à être consommé.
- `TD-INT-SOCIAL-ENTRIES` : écritures sociales réelles (641/645/431…) = décision compta/produit ; seule la **prépa** est faite.
- **Migration 1725** : non rejouée en sandbox (pas de DB) → `migration:run` en local.
- **Analytik R** : aucun couplage ajouté ; consommera l'outbox normalisé — **jamais bloqueur**.

### Addendum v2 (paquets 78→82)
| Paquet | Livré | Preuve |
|---|---|---|
| 78 | **Relais outbox** : policy pure (éligibilité/backoff/outcome) + `OutboxRelayService` + publisher **simulation** + `POST /integration/relay` (admin) | 6/6, build RC=0 |
| 79 | **Events stock/rupture** `stock.movement`/`stock.depleted` (decrement best-effort + adjust post-commit) — Analytik R | 3/3, build RC=0 |
| 80 | **Feed consommateur Analytik R** `GET /integration/events?since&type&limit` (curseur `occurredAt`, tenant) + normaliseur pur | 4/4, build RC=0 |
| 81 | **Rapprochement branché** : `shift-adapter` TW24 pur (tolérant) + `ReconciliationService` (POS DB + TW24 best-effort, dégradé) + `GET /integration/reconciliation` | 5/5, build RC=0 |
| 82 | Consolidation v2 : agrégat **12 suites / 59 tests** intégration, tsc 0 | — |

**Endpoints intégration livrés** : `GET /api/comptamax/journal` (pré-compta) · `POST /api/integration/relay` (flush simulation) · `GET /api/integration/events` (consommateur Analytik R) · `GET /api/integration/reconciliation` (présence POS↔TimeWin). Tous JWT + RBAC + tenant.

**Gates inchangés** : `TD-INT-RELAY` (publisher réel = simulation pour l'instant ; bascule prod = injecter un publisher HTTP, secrets requis) · `TD-INT-SOCIAL-ENTRIES` · migrations 1725 + suites lourdes = local. **Filtre par employé du rapprochement** = niveau magasin/jour pour l'instant (TW24 today-shifts store-scoped) → `TD-INT-RECON-PEREMP`.
