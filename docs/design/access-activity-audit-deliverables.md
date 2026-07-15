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

## Vérification LIVE exécutée (2026-07-15, stack réelle Postgres 16 + backend :3001 + backoffice :5173)

**Migrations sur base VIERGE `caisse_liveverify`** : `migration:run` exit 0 (45 migrations, tête
`CreateUserViewEvents1759000000005`) ; schéma précis vérifié par `\d` (colonnes/types/défauts,
UNIQUE `(employee_id,store_id)` + index partiel `idx_esa_active WHERE revoked_at IS NULL`, FKs
`ON DELETE CASCADE`, UNIQUE anti-fork `UX_access_scope_prevhash (scope,previous_hash)`, aucune
colonne de secret) ; `revert` ×6 exit 0 (tête → `1758`, 0 table, esa → 4 colonnes) ; `re-run`
exit 0 (tête → `1759…005`, 5 tables). Idempotence « No migrations are pending ».

**Tests gated PG activés (chacun sur base vierge)** : 10/10 verts —
`access-activity-migrations 3/3`, `avoir-d14-atomicity 1/1`, `fiscal-e2e 1/1`, `product-packs 2/2`,
`promo-codes 2/2`, `sales-stock 1/1`. Suite standard (pg-mem) : **1026/0**.

**Parcours HTTP réels (curl → backend → PG)** : admin login OK ; grant app-access 201 + store 200 ;
audit `{valid:true}` (2→N entrées hash-chaînées) ; manager `me` = `{storeIds:[Cergy]}` ;
check Cergy 200 ; check Évry **403 `{code:FORBIDDEN, reason:STORE_NOT_IN_SCOPE}`** ;
suspend → **403 `ACCOUNT_SUSPENDED`** ; validUntil passé → **403 `ACCESS_EXPIRED`** ; clear null → 200.

**2 BUGS trouvés en live (que les tests unitaires manquaient — court-circuitaient HTTP) → CORRIGÉS
+ re-vérifiés** (commit `941a3ad`) : (A) le filtre d'exception global écrasait le code métier du
guard par `HTTP_ERROR` → préserve désormais `code`+`reason` (spec §5) ; (B) `grantStoreAccess`
ne pouvait pas EFFACER une borne de validité via `null` → corrigé + test de régression.

**Navigateur (backoffice réel, admin `admin@wesley.test`)** : les 4 onglets rendus avec DONNÉES RÉELLES —
Utilisateurs (2 employés + actions), Connexions (10 logins, **IP masquée** `86.245.•••.•••`, risque
30/65, échec en rouge), Activité (`TAB_OPEN`/`PAGE_VIEW` générés par la navigation même + `ACCESS_DENIED`
Évry), Audit des droits (**badge « Chaîne d'audit intègre »** + mutations réelles). Filtre Échouées → 1
résultat ; état vide (employeeId bidon) → « Aucune connexion ». **Gate admin** : manager redirigé de
`/security` vers `/`.

**Aucun secret dans la télémétrie (§9)** : scan SQL des 3 tables télémétrie → **0 hit** pour
`1234`/`5678`/`password`/`token`/`$2b$`/`pin_hash`/`Bearer`. view_events = `TAB_OPEN`/`PAGE_VIEW`
(metadata nulle) ; login events sans PIN.

## Captures des écrans
Capturées **en session** (pane navigateur), non exportées en fichiers PNG : l'outil de capture
navigateur renvoie l'image inline et n'écrit pas de fichier disque (limitation outil, cause précise).
Captures live prises : (1) login admin ; (2) onglet Utilisateurs ; (3) onglet Connexions ;
(4) filtre Échouées ; (5) état vide ; (6) onglet Activité ; (7) onglet Audit des droits ;
(8) redirection gate manager. Export PNG disque = possible via une passe headless Playwright si requis.

## Verdict final

```
TERMINÉ ET VALIDÉ
```

Backend + frontend **implémentés, testés (1026 pg-mem + 10 gated PG), et VALIDÉS en conditions
réelles** (migrations up/down/up sur vrai PG, schéma vérifié, 4 onglets exercés au navigateur avec
données réelles, 403 codes/périmètre/suspension/expiration/révocation prouvés, zéro secret loggé).
2 bugs découverts en live corrigés + re-vérifiés.

**Réserves explicites (non-défauts fonctionnels)** : (a) le **merge vers `main`** reste **Tier-2,
GO owner requis** (par conception) ; (b) captures = fichiers en session, pas PNG disque (limitation
outil) ; (c) purge de rétention prod = opt-in après validation juridique.
