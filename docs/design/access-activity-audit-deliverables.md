# Gestion des accès + Journal d'activité — Rapport de livrables (§20)

> Branche : `feat/mobile-access-and-activity-audit` (depuis `origin/main` propre) · **11 commits** ·
> 54 fichiers, +4150/−19 · **aucun merge** (attente GO).

## Architecture mise en place
- **Deux dimensions de rôle séparées** : rôle POS (`cashier/manager/admin`) **inchangé** ;
  rôle applicatif de pilotage (`application_role`) porté par `employee_application_access`.
- **Contrôle serveur only** : `AccessService.resolveEffectiveAccess` (source de vérité) +
  `StoreAccessGuard` / `@RequireStoreAccess`. Le front ne reçoit jamais un magasin hors périmètre.
- **Audit des droits immuable** : `access_audit_log` hash-chaîné (réutilise `computeAuditHashV2`
  du module `audit`), append-only, anti-fork, verifier.
- **Télémétrie non bloquante** : `ActivityService` (connexions/sessions/consultations),
  hooks additifs `@Optional()` dans `auth.service`, `SecurityAlertService`, `RetentionService`.
- **Modules** : `pilotage-access`, `activity-audit`. Front : page `SecurityAccessPage` + client télémétrie.

## Migrations (6, additives, réversibles — `1759000000000`→`…005`)
`EnrichEmployeeStoreAccess` · `CreateEmployeeApplicationAccess` · `CreateAccessAuditLog` ·
`CreateUserLoginEvents` · `CreateUserSessions` · `CreateUserViewEvents`.
Aucune sur sales/payments/stock/products ; aucune donnée réécrite ; chaque `down()` = DROP/rollback.

## Routes ajoutées
Pilotage : `GET /pilotage/access/me`, `GET /pilotage/access/check/:storeId`.
Admin RBAC (`@Roles('admin')`) : `POST /pilotage/admin/employees/:id/application-access`,
`POST …/suspend`, `POST …/reactivate`, `PUT …/stores/:storeId`, `DELETE …/stores/:storeId`,
`GET /pilotage/admin/access-audit`, `GET …/access-audit/verify`.
Activité : `GET /activity/login-events`, `GET /activity/sessions`, `GET /activity/view-events`,
`GET /activity/employees/:id/stats`, `POST /activity/sessions/:id/revoke`,
`POST /activity/employees/:id/revoke-sessions`, `POST /activity/view-events` (ingestion).

## Permissions ajoutées
8 rôles applicatifs (STORE_MANAGER…TECHNICAL_ADMIN, CUSTOM_READ_ONLY) ; permissions granulaires
`can_view_dashboard/financials/employees/alerts/compare` ; guard `@RequireStoreAccess(permission?)` ;
codes `403 FORBIDDEN / ACCOUNT_SUSPENDED / ACCESS_EXPIRED`. Rôles centraux/technique = périmètre global.

## Écrans ajoutés
`SecurityAccessPage` (`/security`, admin-gated) — 4 onglets **Utilisateurs / Connexions / Activité /
Audit des droits** ; entrée nav « Administration » ; client télémétrie + hook route-view (Layout).

## Événements journalisés
- **access_audit_log** (12) : ACCESS_GRANTED/UPDATED/REVOKED, ROLE_CHANGED, STORE_ADDED/REMOVED,
  ACCOUNT_SUSPENDED/REACTIVATED, SESSION_REVOKED, ALL_SESSIONS_REVOKED, PASSKEY_ADDED/REMOVED.
- **user_login_events** (7) : LOGIN_SUCCESS/FAILED, LOGOUT, SESSION_EXPIRED/REVOKED, TOKEN_REFRESH, NEW_DEVICE.
- **user_view_events** : 14 actions énumérées + noms métier pointés (liste blanche).
- **Alertes** : LOGIN_RISK_HIGH, ACCESS_DENIED_BURST (score explicable).

## Politique de conservation (opt-in, off par défaut)
login 12 mois · vues détaillées 3 mois · ACCESS_DENIED 12 mois · sessions 12 mois · géo approx 3 mois.
Cron quotidien ; `access_audit_log` **jamais** purgé. À valider juridiquement avant prod.

## Résultat des tests
- **Backend : suite complète 1025 verts / 0 échec** (47 nouveaux, 10 fichiers de specs).
- **Frontend : `tsc --noEmit` OK + build Vite OK** (2002 modules).

## Preuve de scoping serveur
`access-service.spec` (Cergy autorisé / Évry `STORE_NOT_IN_SCOPE`), `store-access-guard.spec`
(403 mappés, altération d'URL sans effet, comparaison multi-magasins bornée), `access-admin.spec`
(révocation coupe l'accès). Le guard vérifie chaque magasin ciblé (params/query/body).

## Preuve qu'aucune donnée sensible n'est loggée
`activity-service.spec` (aucune colonne pin/password/token ; `failure_reason` borné, sans PIN) ;
`activity-view.spec` (`metadata` nettoyée : password/token/pan retirés en profondeur, bornée ;
action arbitraire refusée) ; `auth-telemetry.spec` (l'échec ne transmet aucun pin/mot de passe).
IP hachée (`ip_hash`) + masquage partiel dans la vue standard.

## Captures des écrans
**En attente** — la page est login-gated et consomme l'API ; les captures §20 exigent la stack
complète tournante (voir ci-dessous).

## Verdict final

```
NON TERMINÉ
```

**Fait & vérifié** : tout le backend (RBAC, audit immuable, télémétrie, alertes, rétention,
1025 tests verts) + le frontend (page 4 onglets + télémétrie, tsc + build Vite OK).

**Reste (session de vérification live dédiée, stack complète Postgres + backend + backoffice requise)** :
1. Exécuter les 6 migrations `migration:run` / `migration:revert` sur un vrai Postgres (prouver up/down — §18-20).
2. Vérification navigateur bout-en-bout + **captures des écrans** des 4 onglets (§20).
3. Données seed réelles pour exercer les parcours (grant → login → consultation → audit).
4. Le merge vers `main` reste un **Tier-2** soumis à GO explicite.
