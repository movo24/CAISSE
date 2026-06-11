# Plan de déploiement — CAISSE (état au 2026-06-08)

> Document de préparation. **Aucun déploiement production n'est effectué sans GO explicite du propriétaire.**

## État constaté

| Cible | Version en ligne | État |
|---|---|---|
| `main` (local + GitHub) | `db29db4` | à jour (pos-modules+M1/M3, offline/PDF, analytics) |
| Front prod Vercel `addx-backoffice` → `app.addxintelligence.com`, `admin.addxintelligence.com` | commit `9801b9e2` (~avril) | **périmé** |
| Backend prod Railway → `api.addxintelligence.com` | à jour (2026-06-11) | **live** : `/api/health`=200, `product-analytics`=**401** (existe, à jour). C'est le seul backend CAISSE ; l'URL native Railway `caisse-backend-production.up.railway.app` est morte (404). |
| Preview front à jour | `db29db4` | **déployée (non-prod)** ✅ |

Le push `main` n'a **pas** auto-déployé Vercel (déploiements manuels, pas d'intégration Git auto).

---

## Niveau A — Option sûre immédiate (FAIT)

- [x] Build front backoffice à jour (`tsc --noEmit && vite build` OK)
- [x] **Preview Vercel non-production** déployée — prod intacte
- [x] URL preview vérifiée (HTTP 200, SPA « CAISSE - Back-Office »)
- [x] Lien de partage 23h généré (bypass protection Vercel)
- [x] **Railway non touché**

⚠️ Limite connue : sur la preview, **login + dashboard de base fonctionnent** (proxy `/api` → backend prod), mais les **pages analytics/Performance restent vides** (endpoints `product-analytics`/`sales-trend` = 404 en prod). Normal tant que le backend n'est pas à jour.

---

## Niveau B — Production complète (EN ATTENTE DE TON GO)

**Ordre impératif : backend AVANT front** (sinon l'UI analytics appelle des 404).

### Étape 0 — Pré-checks (read-only, rien n'est déployé)
- [ ] Lister les migrations déjà appliquées en prod : `SELECT name FROM migrations ORDER BY timestamp;` (lecture seule, DB Neon)
- [ ] Identifier les migrations *pending* (probable : `1716000000000-AddInventoryScanClientEntryId`, **additive** = ajout colonne `client_entry_id` nullable → sans perte de données)
- [x] **Revue destructivité FAITE** (lecture seule des fichiers) : toutes les ops `DROP`/`DROP NOT NULL` du repo sont dans les `down()` (rollback). `migrationsRun` n'exécute que les `up()`, qui sont **additifs + idempotents** (`CREATE TABLE/ADD COLUMN/CREATE INDEX IF NOT EXISTS` ; `ALTER … DROP NOT NULL` = simple assouplissement). → **aucune perte de données sur un forward deploy.** Reste à confirmer la *liste* exacte des pending via le `SELECT` ci-dessus.
- [x] Build backend OK (`exit=0`)
- [x] Tests fiscaux **M1/M3** : `avoir-m1-m3.spec` **5/5** + suite audit verte
- [ ] **Snapshot DB Neon** (point-in-time) déclenché AVANT déploiement

### Étape 1 — Migrations
- `migrationsRun: isProd` (app.module.ts:72) applique automatiquement les pending au boot du backend.
- Pending attendues = additives → pas de lock long, pas de perte.
- 🔴 Si une migration destructive apparaît dans la revue → **stop**, prévoir down-migration + restore snapshot.

### Étape 2 — Backend (Railway) — **NÉCESSITE TON GO**
- [ ] Déployer `main` (`db29db4`) sur Railway
- [ ] Surveiller logs boot (migrations + démarrage)
- [ ] Post-deploy : `/api/health`=200, `/api/reports/product-analytics`=**401** (existe), `/api/reports/sales-trend`=**401**

### Étape 3 — Front prod (Vercel)
- [ ] **Promouvoir la preview déjà testée** : `vercel promote <preview-url>` (le plus sûr — on promeut exactement ce qui a été vérifié)
- [ ] OU `vercel --prod` depuis `packages/backoffice-web`

### Étape 4 — Vérification prod
- [ ] `app.addxintelligence.com` : login OK, dashboard, **page Performance avec données** (plus de 404), pas de 500/page blanche, API joignable

---

## Rollback

| Couche | Procédure | Coût |
|---|---|---|
| Front Vercel | `vercel rollback` / re-promouvoir le déploiement `9801b9e2` | instantané (Vercel garde l'historique) |
| Backend Railway | redéployer l'image précédente (commit `9801b9e2`) | quelques minutes |
| Migrations additives (colonne nullable) | **rien à défaire** (inoffensif) | — |
| Migration destructive (le cas échéant) | down-migration + restore snapshot Neon | selon snapshot |

---

## Risques fiscaux — à valider AVANT prod

- **M1** (cap avoir : un avoir ne peut dépasser le reste dû) — **corrigé** dans `main`, couvert par tests. Déployer le backend = **amélioration** (la prod actuelle a encore ce bug).
- **M3** (void d'une vente payée par avoir → restaure le solde, une seule fois, ticket immuable) — **corrigé** dans `main`, couvert par tests. Idem amélioration.
- **M2** (empreinte de hash partielle → liait pas TVA/remise/paiements/horodatage/client) — **corrigé** (branche `fix/fiscal-hash-chain-2026-06`, commit `25d0861`) : empreinte v2 + colonne `hash_version` (rétro-compat, aucun recalcul des tickets v1). Test déterministe.
- **M4** (annulation hors chaîne) — **corrigé** (`6b48e9b`) : table append-only `fiscal_journal`, le void écrit un maillon immuable chaîné par magasin.
- **M5** (chaîne avoir non sérialisée → fork concurrent) — **corrigé** (`5f8ca6e`) : verrou `stores FOR UPDATE` avant lecture du prevHash dans les 2 chemins avoir.
- **Statut** : les 3 sont sur la **branche** `fix/fiscal-hash-chain-2026-06` (PAS encore dans `main`). Suite backend complète **59 suites / 450 tests verts**. 2 migrations **additives** ajoutées (`1717` CREATE TABLE IF NOT EXISTS `fiscal_journal`, `1718` ADD COLUMN IF NOT EXISTS `sales.hash_version`) → forward-safe, sans perte.
- ✅ **Vérificateur de chaîne** livré (branche `feat/fiscal-verify-2026-06`, `f5eb4d7`) : `npm run fiscal:verify` — read-only, linkage par suivi de pointeurs + recalcul de hash (autoritatif pour `fiscal_journal`, best-effort pour sales/credit_notes). Détecte fork/orphan/suppression + tamper de champ.
- ✅ **E2E vrai Postgres** livré (gated `TEST_DATABASE_URL`) : flux réels + vérificateur **verts sur PG 16 / Europe-Paris** → le hash v2 (M2) **se re-vérifie après round-trip timestamp réel**. Suite : 453 verts + 1 skip.
- ⚠️ Reste pour une vraie démarche NF525 : recompute **autoritatif** pour sales/credit_notes (stocker le payload canonique verbatim comme le journal), audit externe, doc d'exploitation/clôture/archivage. Toujours **pas « NF525 validé »**.
- 🐛 Nit constaté : le script npm `migration:run` pointe `./node_modules/typeorm/cli.js` (inexistant en monorepo hoisté) → à corriger pour les migrations manuelles locales (la prod utilise `migrationsRun` au boot, non affectée).

> ⚠️ Ne jamais annoncer « NF525 validé ». M2/M4/M5 ouverts = conformité non garantie.

**Décision en attente : GO explicite pour l'Étape 2 (Railway).** Sans GO : rien en prod, seule la preview existe.
