# Gestion des accès magasins + Journal complet d'activité — Plan technique

> Branche : `feat/mobile-access-and-activity-audit` (depuis `origin/main` propre).
> Statut : **plan ratifié (owner GO)** — implémentation par lots, **aucun merge sans GO**.
> Cadre : mission « accès magasins + journal d'activité » (RBAC pilotage + télémétrie + audit immuable).
> Périmètre exclu : logique fiscale, ventes, paiements Stripe/Terminal, stock, remboursements, clôtures de caisse
> (lecture strictement nécessaire uniquement).

---

## 1. Principe directeur — deux dimensions de rôle séparées

- **Rôle POS** (`employees.role` = `cashier` / `manager` / `admin`) — **inchangé**. Aucun impact sur
  l'encaissement, l'auth POS, le `RolesGuard`, le `TenantInterceptor` existants.
- **Rôle applicatif pilotage** (`application_role`) — **nouveau**, porté par `employee_application_access` :
  `STORE_MANAGER`, `ASSISTANT_MANAGER`, `MULTI_STORE_MANAGER`, `REGIONAL_MANAGER`,
  `CENTRAL_DIRECTOR`, `CENTRAL_ADMIN`, `TECHNICAL_ADMIN`, `CUSTOM_READ_ONLY`.

**Règle effective (évaluée côté serveur uniquement) :**

```
accès accordé =
    compte actif (employees.is_active)
  · application access actif (application_enabled, non suspendu)
  · application_role autorisé pour l'action
  · magasin dans le périmètre (employee_store_access, non révoqué)
  · période de validité active (valid_from/valid_until)
  · permission demandée accordée (can_view_*)
```

Codes d'erreur normalisés : `403 FORBIDDEN` · `403 ACCOUNT_SUSPENDED` · `403 ACCESS_EXPIRED`.
Rôles `CENTRAL_*` / `TECHNICAL_ADMIN` = périmètre global (bypass, comme `admin` POS).

---

## 2. Réutilisation (audit du code existant)

| Brique existante | Réutilisation |
|---|---|
| Module `audit` (`AuditService.log`, `computeAuditHashV2`, `canonicalize`, `verifyChain`, index anti-fork `(store_id, previous_hash)`, retry `23505`) | **Miroir exact** pour `access_audit_log`. Ne PAS utiliser `shared/utils/hash.ts` (formule v1 buggée). |
| `RolesGuard` + `@Roles` + `ROLE_HIERARCHY` | Base rôle POS, inchangée. Le nouveau guard s'ajoute. |
| `TenantInterceptor` + `@SkipTenantCheck` + `@TenantStoreId()` | Les endpoints pilotage passent `@SkipTenantCheck` + nouveau `@RequireStoreAccess` (multi-magasins). |
| Auth : refresh rotatif + token-family + `revoked_tokens` + lockout par IP + trust-proxy borné | Réutilisés pour émission login-events / sessions. |
| `test/helpers/pgmem.ts` + `test/audit-chain-verify.spec.ts` | Harness + patron de test pour la chaîne `access_audit_log`. |
| Back-office : `SettingsPage` (tabs), `SalesGuardsPage` (filtre+pagination+table), `Layout.tsx` (`ROLE_LEVEL`/`hasRole`), `api.ts` (groupes) | Patrons pour la page « Sécurité et accès ». |

**Landmine corrigée au Lot 1 :** `employee_store_access` existe (migration `1711000000000`) mais son **entité est
cassée** (colonnes camelCase `employeeId/storeId/createdAt` + `role` ≠ table réelle `employee_id/store_id/granted_at`,
sans `role`) et **non enregistrée** dans TypeORM. Seul un sous-`SELECT` SQL brut dans `auth.service.ts` l'utilise.

---

## 3. Modèle de données — migrations additives (≥ `1759000000000`)

Toutes additives, réversibles (`down()` = DROP), aucune sur sales/payments/stock/products, aucune donnée réécrite.
Typage TypeORM explicite sur chaque colonne nullable (règle CLAUDE.md).

- **M1 `EnrichEmployeeStoreAccess`** — répare l'entité (mapping `name:` explicite) + ALTER additif :
  `access_role`, `can_view_dashboard/financials/employees/alerts/compare`, `valid_from/until`,
  `granted_by/reason`, `revoked_at/by`, `updated_at`. Révocation **soft-delete in-place**
  (l'`UNIQUE(employee_id, store_id)` existant garantit « pas deux affectations actives identiques »).
- **M2 `CreateEmployeeApplicationAccess`** — `application_enabled`, `application_role`, `permission_level`,
  `primary_store_id`, `valid_from/until`, `suspended_at/by`, `created_by`, timestamps.
- **M3 `CreateUserLoginEvents`** — succès/échec/déconnexion/refresh/nouvel appareil, `authentication_method`,
  `ip_address` + `ip_hash`, `country/region/city`, `approximate_lat/long` (nullable, **jamais GPS continu**),
  `user_agent/device/os/browser`, `is_new_device`, `risk_score`.
- **M4 `CreateUserSessions`** — session **auth** (distincte de `pos_sessions`, comptable-caisse) :
  `started_at`, `last_activity_at`, `ended_at`, `end_reason`, device/geo, `revoked_at/by/reason`.
- **M5 `CreateUserViewEvents`** — consultation : `store_id`, `module`, `screen`, `action` (whitelist),
  `entity_type/id`, `source_route`, `duration_ms`, `metadata_json` (**taille bornée**), `ip/device`.
- **M6 `CreateAccessAuditLog`** — journal **immuable hash-chaîné** (miroir `audit`) : colonnes métier +
  `previous_hash/current_hash/hashed_at/timestamp` + index unique anti-fork `(scope, previous_hash)`.

---

## 4. Backend — nouveaux modules

- **`pilotage-access`** : entités RBAC, `AccessService.resolveEffectiveAccess(employeeId, storeId, permission)`,
  **`StoreAccessGuard` + `@RequireStoreAccess('can_view_financials')`**, contrôleur admin
  (grant / revoke / suspend / reactivate / révoquer-sessions). Endpoints pilotage = `@SkipTenantCheck` +
  `@RequireStoreAccess` (le `TenantInterceptor` mono-magasin bloquerait un régional multi-magasins).
- **`activity-audit`** : `UserLoginEvent` / `UserSession` / `UserViewEvent`, **`AccessAuditService`**
  (chaîne de hash, append-only, verifier `GET /access-audit/verify`), ingestion **asynchrone non bloquante**
  (une panne télémétrie ne bloque JAMAIS login/navigation), cron purge/agrégation, moteur d'alertes (risk score).

## 5. Émission des événements

- **Login/session** : hooks additifs **fire-and-forget** dans `auth.service.ts` (PIN/admin/QR/mobile),
  enveloppés pour ne jamais lever dans le chemin de login. IP déjà captée (`req.ip`), UA parsé.
- **Consultation** : client télémétrie léger dans **backoffice-web**, hook route-view dans `Layout.tsx`,
  noms d'événements métier **whitelistés** (`dashboard.kpi.revenue.open`, `store.selector.change`,
  `comparison.store.add`, `access.store.denied`…), envoi **batché**.

## 6. Back-office — page « Sécurité et accès »

`SecurityAccessPage.tsx` admin-gated (route `/security`, groupe admin de `Layout.tsx`), 4 onglets :
**Utilisateurs / Connexions / Activité / Audit des droits**. Groupe `securityApi` dans `api.ts`
(réconcilier `page/limit` ↔ `limit/offset`).

## 7. Confidentialité & conformité (cadre CNIL)

IP approximative dérivée de l'IP seulement, **jamais de GPS continu** · masquage partiel d'IP en vue standard ·
whitelist d'événements + `metadata_json` borné · **aucun** secret/token/mot de passe/PAN loggé (prouvé par test) ·
rétention **configurable, prudente** (login 12 mois, vues détaillées 3 mois, agrégées 24 mois, sessions 12 mois,
géo 3 mois) via cron · valeurs **à valider juridiquement avant prod**. Aucune fausse donnée permanente
(seed uniquement en tests).

---

## 8. Découpage en lots (petits, testables, commit par lot)

| Lot | Livrable | Migration |
|-----|----------|-----------|
| 0 | Branche + ce doc de plan | — |
| 1 | Fix + enrichissement `employee_store_access` (entité + M1 + enregistrement TypeORM) | M1 |
| 2 | `employee_application_access` (M2) + `AccessService` + tests validité/suspension/périmètre | M2 |
| 3 | `StoreAccessGuard` + `@RequireStoreAccess` + codes 403 + tests isolation (Cergy oui / Évry non) | — |
| 4 | `access_audit_log` (M6) hash-chaîné + verifier + tests append-only/altération | M6 |
| 5 | Endpoints admin RBAC + onglets **Utilisateurs** & **Audit des droits** | — |
| 6 | `user_login_events` (M3) + `user_sessions` (M4) + hooks émission auth non bloquants + onglet **Connexions** | M3, M4 |
| 7 | `user_view_events` (M5) + ingestion + client télémétrie backoffice + onglet **Activité** + test « aucun secret loggé » | M5 |
| 8 | Alertes sécurité (risk score, nouvel appareil, voyage impossible, refus répétés) | — |
| 9 | Cron rétention/purge + config + tests de purge | — |
| 10 | Suite complète + lint + build + rapport de livrables (§20). **Aucun merge** | — |

## 9. Tests §18 (mappés)

Isolation Cergy/Évry (1-4) → Lot 3 · expiration accès temporaire (5) → Lot 2/3 · révocation immédiate (6) → Lot 3/5 ·
login réussi/échoué journalisé sans mot de passe (7-8) → Lot 6 · changement de magasin / KPI journalisés (9-10) → Lot 7 ·
session révoquée inutilisable (11) → Lot 6 · cloisonnement lecture des journaux (12) → Lot 5 ·
filtre admin par employé/magasin (13) → Lot 5-7 · aucun token/mot de passe/PAN loggé (14) → Lot 7 ·
purge (15) → Lot 9 · non-blocage télémétrie (16) → Lot 7 · frontend ne reçoit jamais un magasin non autorisé (17) → Lot 3 ·
comparaison multi-magasins respecte le périmètre (18) → Lot 3 · exports audités (19) → Lot 5/7 ·
migrations up/down propres (20) → chaque lot.

## 10. Points de contrôle (STOP → GO)

- Tier-2 restant : **merge vers `main`** — jamais sans GO explicite en canal.
- Redemander si : décision produit non tranchable, ou surface auth sensible touchée au-delà de l'émission additive.
