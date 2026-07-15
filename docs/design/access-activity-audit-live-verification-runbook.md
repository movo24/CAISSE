# Runbook — Vérification LIVE « Sécurité et accès »

> À exécuter par l'**opérateur** dans une session dédiée. L'agent ne déclare JAMAIS ces
> vérifications faites lui-même. Branche `feat/mobile-access-and-activity-audit`.
> Migrations up/down sur vrai PG = **déjà prouvé** (voir `…-deliverables.md` §Tests) ;
> ici on prouve le comportement bout-en-bout + captures §20.

## 0. Pré-requis
- Postgres local (brew `postgresql@16` ou `npm run docker:up`).
- `jq` pour les exemples curl (`brew install jq`).

## 1. Boot de la stack

```bash
# a) Base dev (NODE_ENV=development ⇒ migrationsRun=false ⇒ migrations manuelles)
createdb caisse_dev 2>/dev/null || true
psql caisse_dev -c 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";'
cd packages/backend
DATABASE_URL='postgresql://<user>@localhost:5432/caisse_dev' npm run migration:run   # applique la lignée + les 6 nouvelles

# b) Backend API (:3001)   — nécessite JWT_SECRET/JWT_REFRESH_SECRET ≥32 (openssl rand -hex 32) + DATABASE_URL
cd /… && npm run dev:backend

# c) Back-office (:5173)
npm run dev:backoffice
```

## 2. Données de test (via les endpoints admin de la feature)

> Un compte **admin** doit exister (rôle POS `admin`). S'il n'y en a pas en base dev,
> en créer un par le parcours d'amorçage habituel du projet (seed / `POST /employees` par un admin
> existant). Récupérer aussi 2 `storeId` (ex. Cergy, Évry) et 1 `employeeId` manager cible.

```bash
API=http://localhost:3001/api
TOKEN=$(curl -s -XPOST $API/auth/login/admin -H 'Content-Type: application/json' \
  -d '{"email":"<ADMIN_EMAIL>","pin":"<PIN>"}' | jq -r .accessToken)
AUTH="Authorization: Bearer $TOKEN"; JSON="Content-Type: application/json"
EMP=<MANAGER_EMPLOYEE_ID>; CERGY=<CERGY_STORE_ID>; EVRY=<EVRY_STORE_ID>

# Accès pilotage (rôle applicatif) + périmètre Cergy avec financier
curl -s -XPOST $API/pilotage/admin/employees/$EMP/application-access -H "$AUTH" -H "$JSON" \
  -d '{"applicationRole":"STORE_MANAGER"}'
curl -s -XPUT  $API/pilotage/admin/employees/$EMP/stores/$CERGY -H "$AUTH" -H "$JSON" \
  -d '{"canViewFinancials":true}'
```

## 3. Preuves de scoping serveur (attendus EXACTS)

Se connecter en tant que le manager cible (récupérer son propre token via `/auth/login/pin`),
puis appeler l'endpoint sonde :

| Appel (en tant que manager) | Attendu |
|---|---|
| `GET /pilotage/access/check/$CERGY` | `200 { allowed:true }` |
| `GET /pilotage/access/check/$EVRY` | `403` corps `{ code:"FORBIDDEN", reason:"STORE_NOT_IN_SCOPE" }` |
| `GET /pilotage/access/me` | `{ global:false, storeIds:[<CERGY>] }` |

Puis, en admin, muter et re-tester :

| Action admin | Puis check Cergy (manager) |
|---|---|
| `POST …/$EMP/suspend` | `403 { code:"ACCOUNT_SUSPENDED" }` |
| `POST …/$EMP/reactivate` puis `PUT …/stores/$CERGY -d '{"validUntil":"2020-01-01T00:00:00Z"}'` | `403 { code:"ACCESS_EXPIRED" }` |
| `DELETE …/$EMP/stores/$CERGY` | `403 { code:"FORBIDDEN", reason:"STORE_NOT_IN_SCOPE" }` |

Chaque mutation doit apparaître dans `GET /pilotage/admin/access-audit` (ACCESS_GRANTED,
STORE_ADDED, ACCOUNT_SUSPENDED/REACTIVATED, STORE_REMOVED) et `…/access-audit/verify` → `{valid:true}`.

## 4. Parcours navigateur `/security` (admin) + captures §20

Se connecter au back-office (:5173) en **admin** → menu **Administration → Sécurité et accès**.
(Un non-admin doit être redirigé `/` — le vérifier.)

| Onglet | À observer | Capture |
|---|---|---|
| **Utilisateurs** | table employés ; boutons Accès…/Suspendre/Réactiver/Révoquer sessions ; accorder un rôle applicatif | `01-utilisateurs.png` |
| **Connexions** | lignes de login (après quelques `/auth/login/*`) ; **IP masquée** `x.y.•••.•••` ; colonne Risque ; filtre Réussies/Échouées | `02-connexions.png` |
| **Activité** | chronologie des consultations (naviguer génère des `PAGE_VIEW` via le hook route-view) ; filtre par action | `03-activite.png` |
| **Audit des droits** | table des mutations + **badge « Chaîne d'audit intègre »** (vert) | `04-audit-droits.png` |

## 5. Cas d'échec à provoquer et observer
- Tenter Évry en manager → `access.store.denied` (403) ; répéter ≥5× en 10 min → alerte `ACCESS_DENIED_BURST` (logs backend / AlertService).
- Login échoué (mauvais PIN) → apparaît « Échouée » dans Connexions, **sans** le PIN.
- Login depuis un nouvel appareil/pays (UA/geo différents) → `risk_score` > 0, alerte `LOGIN_RISK_HIGH` si ≥ seuil.
- Couper le backend pendant la navigation → l'UI **ne casse pas** (télémétrie non bloquante) ; les vues sont juste perdues.

## 6. Ce qui reste gated
- **Merge vers `main`** = Tier-2, GO explicite requis.
- Purge de rétention en prod = opt-in (`RETENTION_PURGE_ENABLED=true`) après validation juridique.
