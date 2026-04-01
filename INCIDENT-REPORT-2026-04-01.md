# RAPPORT D'INCIDENT — 2026-04-01
## Base de donnees prod partagee POS/TW24

---

## Cause racine

**POS Backend Railway et TimeWin24 partagent la MEME base PostgreSQL Neon** (`neondb` sur `ep-square-violet-agqygacb-pooler`).

Un `prisma db push --accept-data-loss` execute sur TimeWin24 a **supprime toutes les tables POS** (employees, stores, products, sales, etc.) car elles ne font pas partie du schema Prisma TW24.

## Chronologie

1. Variables Railway manquantes (TIMEWIN24_URL etc.) → corrigees via Chrome
2. Endpoint `store-schedules` TW24 retournait 500 → contrainte unique manquante
3. `prisma db push --accept-data-loss` execute pour corriger le schema TW24 → **a supprime les tables POS**
4. Login POS retourne 500 → `relation "employees" does not exist`
5. Tables POS recreees manuellement via SQL
6. Login POS retabli

## Donnees perdues

- **33 produits** (catalogue complet)
- **3831 ventes** (historique complet)
- Promotions, clients, rapports Z, sessions

**Recuperation** : verifier si Neon propose un point-in-time restore.

## Etat actuel

| Composant | Statut |
|-----------|--------|
| Login admin | ✅ OK |
| Login PIN | ⚠️ Erreur validation (a investiguer) |
| Stores | ✅ 4-5 stores syncees depuis TW24 |
| Employees | ✅ 1 admin |
| Products | ✅ 0 (base propre) |
| Horaires magasin | ✅ 7 jours dans TW24 DB |
| Schedule via POS API | ⚠️ Vide (proxy TW24 en recovery) |
| Health | ✅ OK |
| Receipt 404 | ✅ OK |

## Configuration prod actuelle

| Service | Base | ORM |
|---------|------|-----|
| POS Backend (Railway) | Neon `neondb` | TypeORM |
| TimeWin24 (Vercel) | Neon `neondb` (MEME) | Prisma |

**C'est le probleme fondamental.** Deux ORM (TypeORM + Prisma) sur la meme base, avec des schemas incompatibles.

## Variables Railway Backend (12)

- ✅ CORS_ORIGIN, DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET
- ✅ NODE_ENV=production, PORT=3001, TYPEORM_SYNCHRONIZE=false
- ✅ TIMEWIN24_URL, TIMEWIN24_API_KEY, TIMEWIN24_POS_SECRET
- ❌ SENTRY_DSN (absent)
- ❌ REDIS_URL (absent)
- ❌ STRIPE_SECRET_KEY (absent)

## Schema POS recree — verification

| Table | Colonnes | Index | Contraintes |
|-------|----------|-------|-------------|
| employees | 12 ✅ | idx_employees_store ✅ | PK ✅ |
| stores | 35 ✅ | stores_store_code_key ✅ | PK + UNIQUE(store_code) ✅ |
| products | 20 ✅ | idx_products_store ✅ | PK ✅ |
| sales | 18 ✅ | idx_sales_store_id ✅ | PK ✅ |
| sale_payments | 9 ✅ | — | PK ✅ |
| employee_store_access | 4 ✅ | — | PK + UNIQUE(emp,store) ✅ |

---

## ACTIONS PRIORITAIRES

### P0 — CRITIQUE : Separer les bases

| Action | Effort | Impact |
|--------|--------|--------|
| Creer une base Neon dediee POS | 30 min | Elimine le risque de destruction croisee |
| Mettre a jour DATABASE_URL Railway | 5 min | Pointe vers la nouvelle base |
| Migrer les donnees POS | 1h | Copier les tables POS vers la nouvelle base |
| Tester | 30 min | Valider que tout fonctionne |

### P1 — SECURITE : Rotation des secrets

Les secrets suivants ont ete exposes dans cette conversation :
- DATABASE_URL (credentials Neon)
- JWT_SECRET, JWT_REFRESH_SECRET
- TIMEWIN24_API_KEY, TIMEWIN24_POS_SECRET
- PIN admin (250781)

**Action** : rotater tous ces secrets dans les 24h.

### P2 — MONITORING

- Ajouter SENTRY_DSN sur Railway (le DSN existe : `https://d2c96f71...@o4511...sentry.io/4511...`)
- Ajouter REDIS_URL (pour token revocation multi-instance)
- Ajouter STRIPE_SECRET_KEY (pour paiements carte)

### P3 — POLITIQUE PROD

**Interdiction formelle :**
- `prisma db push` en production
- `TYPEORM_SYNCHRONIZE=true` en production
- Toute commande destructive sans backup prealable

**Obligation :**
- Migrations versionnees uniquement
- Backup avant changement de schema
- Audit des tables avant et apres migration

---

## Lecons apprises

1. **Ne jamais partager une base entre deux apps avec des ORM differents**
2. **Ne jamais executer `db push --accept-data-loss` en production**
3. **Toujours verifier le DATABASE_URL avant une operation destructive**
4. **Les logs Railway sont la seule source de verite pour les erreurs prod** (Sentry n'etait pas configure)
