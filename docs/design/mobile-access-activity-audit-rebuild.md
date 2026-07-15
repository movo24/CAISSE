# Accès applicatifs & Audit d'activité — Reconstruction (Lot 0)

> Branche : `feat/mobile-access-rebuild-2026-07` (depuis `origin/main@5fbe11e`).
> Spécification source : message normatif owner (2026-07-15) — le chantier d'origine
> (`feat/mobile-access-and-activity-audit`, lots 0–5 annoncés) est **perdu** : aucun de
> ses objets Git n'existe (vérifié : cat-file/reflog/ls-remote). Reconstruction propre.
> Règles : aucun merge `main` · commits incrémentaux poussés par lot · chemins explicites ·
> migrations prouvées sur PostgreSQL réel · zéro secret dans les événements · hooks auth
> non bloquants · révocation idempotente · mutations admin opposables (chaîne dédiée).

## 1. État existant VÉRIFIÉ (audit 2026-07-15, références fichier:ligne)

### 1.1 Employé, rôles
- `employee.entity.ts` : `id, store_id, first_name, last_name, email, pin_hash (select:false),
  qr_code (unique), role (varchar libre, défaut 'cashier'), max_discount_percent, is_active
  (boolean, défaut true), created_at`. **Seul état de suspension = `isActive` binaire** ;
  aucun `status/suspendedAt/validUntil`.
- Rôles réels : `cashier(0) < manager(1) < admin(2)` — `roles.guard.ts:18-44`, héritage
  ascendant, rôle inconnu → niveau −1 (refus). **Aucun rôle `central`/`technical admin`
  n'existe** → arbitrage §4.3.

### 1.2 `employee_store_access` — DIVERGENCE entité ↔ migration (réelle, latente)
- Migration `1711` (schéma prod réel) : `id, employee_id (FK CASCADE), store_id (FK CASCADE),
  granted_at`, `UNIQUE(employee_id, store_id)`.
- Entité : colonnes **camelCase** (`employeeId/storeId/createdAt` — pas de SnakeNamingStrategy,
  vérifié `app.module.ts:71-89`), colonne **`role` fantôme** (varchar 50 défaut `'active'`,
  absente de la migration), ignore `granted_at`, aucune FK.
- Non bloquant aujourd'hui car **aucun repository ne l'utilise** : `auth.service.ts:489`
  interroge la table en SQL brut snake_case (+ fallback si table absente `:494-507`).
  Tout `repo.find/save` futur casserait en prod (`synchronize:false`).
- **Aucune** colonne révocation/validité/permissions aujourd'hui.

### 1.3 Authentification & révocation (employés)
- Endpoints : `POST /auth/login/pin | /auth/login/admin (email) | /auth/login/qr |
  /auth/refresh (body ou cookie httpOnly caisse_refresh_token) | /auth/logout`
  (`auth.controller.ts:60-158`). PIN/email : local d'abord, TW24 en secours ; QR : TW24 only.
- JWT access 15 min (claims `sub, storeId, role, employeeName, maxDiscount`) ; refresh 7 j
  avec **`jti`**.
- **Révocation existante = cache uniquement** (`ICacheStore`, Redis sinon mémoire) :
  `logout` → `sadd revoked_tokens(employeeId, TTL 7j)` + `del token_family` (`:385-389`) ;
  `validateEmployee` vérifie `revoked_tokens` **puis re-lit `isActive` en DB à chaque
  requête** (`:262-275`, appelé par `jwt.strategy.ts:16-26`) ; le refresh fait rotation de
  `jti` + détection de replay → révocation de famille (`:280-328`).
  ⇒ la révocation est **déjà opposable** aux requêtes ET au refresh, mais **volatile**
  (perte au restart sans Redis) et **invisible** (aucune liste de sessions).
- **Mobile (Wesley Club) : AUCUNE révocation** — `mobile-auth.service.ts:92-108` (refresh =
  signature+audience seulement), logout = no-op (`mobile-auth.controller.ts:52-57`),
  refresh 30 j. Hors périmètre des lots 1–10 (employés) → §11 non-objectifs, dette notée.

### 1.4 Chaîne d'audit existante (modèle à répliquer)
- `audit_entries` + `AuditService` : hash v2 canonique recomputable (`canonicalize` trié,
  `audit.service.ts:34-53`), `hashed_at`, index unique anti-fork `(store_id, previous_hash)`
  (migration 1744), mutex par magasin + 4 retries sur 23505 (`:99-163`), `verifyChain`
  (linkage + recompute, `:187-218`), échec final → `AlertService.fire('AUDIT_WRITE_FAILED')`.
- Logins **admin/email** déjà audités (`admin_login`/`admin_login_failed`,
  `auth.service.ts:66-111`) ; logins **PIN caissier : non audités** (rien dans
  `authenticateLocal`).

### 1.5 Infra réutilisable
- `AlertService.fire(event, message)` — canaux : console structurée + webhook
  (`ALERT_WEBHOOK_URL`), dédup 1/min (`alert.service.ts:68-110`). Pas de canal DB/email.
- Cron : `@nestjs/schedule` global (`app.module.ts:66`) ; gabarits : `shift-reminders`
  (flag off par défaut, no-op gracieux) et `employee-score.cron` (nightly 03:00
  Europe/Paris).
- **Score employé existant** (module `employee-score`, migration 1747 : ledger d'événements
  + barème versionné + agrégats journaliers + cron + page front) — à ÉTENDRE, pas à
  recréer, pour le volet « score de risque ».
- `pos_sessions` = sessions de **caisse** (terminal), PAS des sessions d'auth.
- `connected-apps` = apps tierces par organisation, PAS un référentiel d'applications
  internes (aucune constante POS/BACKOFFICE n'existe).
- Rétention/purge : quasi inexistante (seul soft-delete customer M302, gelé).
- Tests PG réels : pattern `*.pg.spec.ts` gated par `TEST_DATABASE_URL`… mais avec
  **`synchronize:true`** (schéma construit depuis les ENTITÉS, migrations non exécutées —
  ex. `avoir-d14-atomicity.pg.spec.ts:31-48`). ⚠️ Ce pattern ne détecterait PAS la
  divergence §1.2 → stratégie de test dédiée §9.
- Backoffice : routes inline `main.tsx:69-131` ; `ProtectedRoute` ne vérifie QUE
  l'authentification (pas le rôle) — le contrôle admin est backend + masquage menu
  (`Layout.tsx:25-48`, `minRole`) ; pas de composant Table/Tabs partagé — gabarits :
  `EmployeeScoresPage` (table+filtres+badges), onglets de `ReportsPage`/`SettingsPage` ;
  client API par objets dans `services/api.ts`.

## 2. Architecture cible (vue d'ensemble)

```
employee_store_access (existant, corrigé)   employee_application_access (nouveau)
        │ périmètre MAGASIN                        │ périmètre APPLICATION
        └──────────────┬────────────────────────────┘
                 AccessService (résolution d'accès effectif)
                       │
        @RequireStoreAccess(...) + StoreAccessGuard (403 codés)
                       │
   Mutations admin ──► access_audit_log (chaîne de hash DÉDIÉE, append-only)
   Logins/refresh/logout ──► user_login_events (hooks fire-and-forget)
   Refresh/requêtes ──► user_sessions (persistance + révocation opposable)
   Backoffice ──► user_view_events (whitelist, identité serveur)
   Signaux ──► risk score (extension employee-score) ──► AlertService
   Cron rétention (opt-in) — ne touche JAMAIS access_audit_log
   Front : /security « Sécurité et accès » (4 onglets, admin)
```

## 3. Schémas SQL proposés (migrations ADDITIVES ; numérotation à partir de 1759)

### 3.1 Lot 1 — correction minimale `employee_store_access`
Deux volets :
- **Entité réalignée sur la migration 1711** (aucun changement DB) :
  `@Column({name:'employee_id',type:'uuid'})`, `…'store_id'…`,
  `@CreateDateColumn({name:'granted_at'})`, suppression de la colonne fantôme `role`.
- **Migration 1759 additive** (colonnes de la spec §3.A, toutes nullables → zéro impact) :
  `revoked_at timestamptz NULL, revoked_by uuid NULL, valid_from timestamptz NULL,
  valid_until timestamptz NULL, granted_by uuid NULL, permissions jsonb NULL,
  justification varchar(500) NULL`.
  L'unicité `(employee_id, store_id)` existante reste la garde anti-doublon : une
  ré-attribution après révocation = UPDATE de la ligne (ré-activation tracée) — pas de
  doublons actifs possibles.

### 3.2 Lot 2 — `employee_application_access` (nouvelle table, migration 1760)
```
id uuid PK · employee_id uuid NOT NULL (FK employees CASCADE)
application varchar(30) NOT NULL          -- constantes centralisées, table ouverte
permission varchar(30) NOT NULL DEFAULT 'use'
valid_from/valid_until timestamptz NULL · granted_at timestamptz NOT NULL DEFAULT now()
granted_by uuid NULL · revoked_at timestamptz NULL · revoked_by uuid NULL
justification varchar(500) NULL · created_at/updated_at
INDEX (employee_id, application) ; UNIQUE PARTIEL (employee_id, application, permission)
  WHERE revoked_at IS NULL   -- « plusieurs autorisations actives strictement identiques » impossibles
```
Constantes (`shared` ou `common/constants/applications.ts`) :
`POS, BACKOFFICE, OWNER_MOBILE, TIMEWIN24, ANALYTIK_R` — liste extensible, aucun `if app`.

### 3.3 Lot 4 — `access_audit_log` (migration 1761) — chaîne DÉDIÉE
```
id uuid PK · event_type varchar(40) NOT NULL
actor_employee_id uuid NOT NULL · target_employee_id uuid NOT NULL
application varchar(30) NULL · store_id uuid NULL
before jsonb NULL · after jsonb NULL      -- bornés (allowlist + taille max)
justification varchar(500) NULL · created_at timestamptz NOT NULL DEFAULT now()
previous_hash varchar(64) NOT NULL · current_hash varchar(64) NOT NULL
hash_version smallint NOT NULL DEFAULT 2
UNIQUE (previous_hash)                    -- anti-fork GLOBAL (chaîne unique, cf. §5.2)
INDEX (target_employee_id, created_at) · INDEX (created_at)
```
### 3.4 Lot 6 — `user_login_events` (migration 1762)
```
id uuid PK · employee_id uuid NULL · application varchar(30) NOT NULL
store_id uuid NULL · terminal_id varchar(64) NULL
auth_method varchar(20) NOT NULL          -- pin|email|qr|refresh|logout (catégorie)
outcome varchar(20) NOT NULL              -- success|failure|denied
reason varchar(60) NULL                   -- motif NORMALISÉ (enum, jamais de texte libre)
device_fingerprint varchar(64) NULL       -- hash non secret
ip_hash varchar(64) NULL                  -- sha256(ip + pepper serveur), jamais l'IP claire
geo_region varchar(60) NULL               -- approximatif, sans GPS
risk_score smallint NULL · risk_factors jsonb NULL
created_at timestamptz NOT NULL DEFAULT now()
INDEX (employee_id, created_at) · INDEX (created_at) · INDEX (outcome, created_at)
```
### 3.5 Lot 6 — `user_sessions` (migration 1763)
```
id uuid PK (opaque) · employee_id uuid NOT NULL · application varchar(30) NOT NULL
store_id uuid NULL · device_label varchar(120) NULL · jti_hash varchar(64) NOT NULL
created_at · last_seen_at · expires_at timestamptz NOT NULL
revoked_at timestamptz NULL · revoked_by uuid NULL · revoke_reason varchar(200) NULL
INDEX (employee_id) WHERE revoked_at IS NULL · INDEX (expires_at)
```
### 3.6 Lot 7 — `user_view_events` (migration 1764)
```
id uuid PK · employee_id uuid NOT NULL    -- estampillé DEPUIS LE JWT, jamais du body
action varchar(60) NOT NULL               -- whitelist serveur
store_id uuid NULL · metadata jsonb NULL  -- borné (≤2 Ko) + scrub récursif
created_at timestamptz NOT NULL DEFAULT now()
INDEX (employee_id, created_at) · INDEX (action, created_at)
```

## 4. Contrats de services et guards

### 4.1 `AccessService.resolve(query) → AccessDecision`
Entrée `{ employeeId, application, permission, storeId? }` → sortie
`{ allowed, code?: 'FORBIDDEN'|'ACCOUNT_SUSPENDED'|'ACCESS_EXPIRED', matchedGrant? }`.
Règles (toutes testées) : compte inexistant/`isActive=false` → `ACCOUNT_SUSPENDED` ;
autorisation révoquée → `FORBIDDEN` ; `valid_from` futur → `FORBIDDEN` ; `valid_until`
passé → `ACCESS_EXPIRED` ; magasin hors périmètre → `FORBIDDEN` (multi-magasins =
**union explicite** des lignes actives) ; permission insuffisante → `FORBIDDEN`.
Le masquage frontend n'est jamais un contrôle.

### 4.2 Guard
`@RequireStoreAccess(application, permission)` + `StoreAccessGuard` : identité **uniquement**
depuis `req.user` (jamais un `employee_id` client) ; storeId résolu depuis le contexte
(`params/query` confronté au périmètre, même esprit que `TenantInterceptor`) ; 403 avec
`{ code }` stable ; compatible mono et multi-magasins ; tests d'isolation croisée.

### 4.3 Arbitrage rôles (documenté, pas de rôle fictif)
Rôles réels = `cashier/manager/admin` uniquement. **Proposition** : `admin` conserve son
bypass périmètre magasin (cohérent avec `TenantInterceptor:71`) mais **PAS** de bypass des
accès applicatifs révoqués/suspendus (une révocation vaut pour tous). Aucun rôle
`central`/`technical` n'est créé. → à valider owner au plus tard à la revue du Lot 3.

## 5. Chaîne `access_audit_log`
- Événements : `access_granted, permission_changed, access_revoked, account_suspended,
  account_reactivated, session_revoked, sessions_revoked_all, validity_changed,
  store_scope_changed`.
- Mécanique répliquée de `AuditService` (mutex, retry 23505, hash v2 canonique,
  `verify()`) mais **chaîne séparée, jamais mélangée à `audit_entries`** ; portée globale
  (unique `previous_hash` global — volumétrie faible, écriture sérialisée par mutex
  process + retry ; le multi-instance est couvert par la contrainte unique).
- **Différence assumée vs audit existant : écriture IN-TRANSACTION avec la mutation**
  (une mutation admin sans son entrée d'audit est un échec de la mutation) — les mutations
  d'accès sont rares, l'opposabilité prime (leçon dette D16).
- `before/after` bornés par allowlist de champs (jamais de hash de PIN, jamais de token).

## 6. Événements & hooks non bloquants (Lot 6)
- `ActivityService.record(event)` : **fire-and-forget** — `setImmediate` + `try/catch`
  total + timeout court ; AUCUN `await` dans les chemins `login/refresh/logout` ; un échec
  d'écriture ne change JAMAIS la réponse d'auth (tests dédiés avec service en panne).
- Événements : succès/échec login (pin|email|qr), refresh success/failure, logout, refus
  droits/suspension. Motifs normalisés (`bad_pin`, `locked_out`, `revoked`, `suspended`,
  `replay_detected`, …).
- `user_sessions` : créée au login (id opaque + `jti_hash`), `last_seen_at` au refresh ;
  **la révocation s'appuie sur le mécanisme DÉJÀ opposable** (`revoked_tokens` +
  `validateEmployee` + rotation `jti`, §1.3) — la table ajoute la **persistance** (survit
  au restart : au boot, les sessions `revoked_at IS NOT NULL` non expirées réalimentent le
  cache) et la **visibilité** (liste, révocation ciblée par session via son `jti_hash`).
  Révocation **idempotente** : `UPDATE … SET revoked_at=now() WHERE id=:id AND revoked_at
  IS NULL` → 0 ligne = déjà révoquée/terminée → réponse `already_revoked`, AUCUNE nouvelle
  écriture d'audit ni d'alerte (« ne jamais révoquer deux fois »).

## 7. Confidentialité (interdictions absolues)
Jamais stockés/loggés dans AUCUNE table/événement/métadonnée : PIN, mot de passe, hash de
PIN, token (access/refresh), `jti` en clair (seul `jti_hash`), QR brut, cookie, header
d'autorisation, corps métier sensible, GPS précis. IP uniquement hachée+poivrée ;
métadonnées `user_view_events` passées au **scrub récursif** (clés `pin|password|token|
secret|authorization|cookie|qr` supprimées à toute profondeur) + plafond de taille + lots
plafonnés. Tests dédiés (§10.9/12).

## 8. Rétention (opt-in, Lot 9)
Purge **désactivée par défaut** (`ACTIVITY_RETENTION_ENABLED=true` pour activer). Jamais
de purge d'`access_audit_log`. Défauts proposés (à valider) : `user_view_events` 90 j ·
`user_login_events` 365 j (anonymisation `geo_region`/`ip_hash` à 180 j) ·
`user_sessions` terminées 90 j. Purge par lots bornés (`LIMIT`), lignes expirées
uniquement, compte rendu de purge journalisé (log structuré + alerte info).

## 9. Stratégie migrations & tests PostgreSQL réels
- Migrations **additives uniquement**, numérotation ≥ 1759, `down()` propres.
- ⚠️ Le pattern PG existant (`synchronize:true`) ne prouve pas les migrations → ce chantier
  ajoute un pattern dédié : datasource `migrationsRun` sur base réelle (`TEST_DATABASE_URL`),
  test `up` → assertions de schéma → `down` → `up` (spec §14.19-20). pg-mem en complément
  pour la logique, jamais comme preuve de migration.
- Divergence §1.2 : un test PG vérifie que l'ENTITÉ réalignée lit/écrit la table réelle
  issue des MIGRATIONS (le bug actuel serait détecté).

## 10. Frontend `/security` — « Sécurité et accès » (Lot 10 ; client télémétrie Lot 7)
Route dans `main.tsx` (bloc Layout) + entrée nav `minRole:'admin'` + **wrapper
`AdminRoute`** (à créer — `ProtectedRoute` ne vérifie pas le rôle) ; endpoints backend
`@Roles('admin')` = la vraie garde. 4 onglets (pattern `ReportsPage`) : **Utilisateurs**
(accès applicatifs, périmètre magasins, états actif/suspendu/expiré/révoqué, sessions
actives + révocation unitaire/globale) · **Connexions** (`user_login_events` + score et
facteurs) · **Activité** (`user_view_events`) · **Audit des droits** (`access_audit_log`
+ vérification de chaîne). Filtres période/magasin, recherche utilisateur, états
chargement/vide/erreur — composants et styles existants (gabarit `EmployeeScoresPage`),
pas de second design system. Client télémétrie : batch + flush périodique/`beforeunload`,
jamais bloquant, tolère l'API down, aucun secret.

## 11. Score & alertes (Lot 8)
Score déterministe et explicable, calculé serveur à l'écriture du login event : facteurs
additifs bornés (nouvel appareil, nouvelle région, rafale d'échecs, régions incompatibles
rapprochées, tentative post-révocation, app non autorisée, multiplication de sessions) ;
`risk_factors` conserve chaque facteur + poids. Seuils robustes (jamais d'alerte sur un
simple changement d'IP mobile). Canal = `AlertService.fire` existant (nouveaux
`AlertEvent` : `ACCESS_SUSPICIOUS_LOGIN`, `ACCESS_AFTER_REVOCATION`) — pas de notification
inventée ; si le webhook n'est pas configuré, l'événement interne suffit (manque documenté).

## 12. Découpage des lots (confirmé, 2 ajustements justifiés)
Lots 0–10 = spec owner. Ajustements :
1. **Lot 1 est NÉCESSAIRE** (pas « si nécessaire ») : la divergence entité↔migration est
   réelle (§1.2) — réalignement entité + migration additive 1759.
2. **Lot 6** : `user_sessions` s'adosse au mécanisme de révocation cache EXISTANT (déjà
   opposable au refresh et aux requêtes) au lieu d'en créer un second — la table apporte
   persistance + visibilité + idempotence (§6). Preuve d'opposabilité = tests §14.14.

## 13. Risques & non-objectifs
**Risques** : R-A cache de révocation volatile sans Redis (mitigé par la réhydratation
boot depuis `user_sessions`, résiduel documenté) · R-B volumétrie `user_view_events`
(bornage + rétention) · R-C double écriture login-event/audit admin_login existant
(assumée : chaînes différentes, pas de suppression de l'existant) · R-D charge du guard
(1 requête indexée par hit ; cache court optionnel en P2 si mesuré nécessaire).
**Non-objectifs** : révocation mobile Wesley Club (dette notée §1.3) · SSO/OAuth ·
gestion des rôles au-delà des 3 existants · notifications push · modification des flux
fiscaux/ventes/paiements/stock (interdits par la spec) · purge d'`access_audit_log`
(jamais).
