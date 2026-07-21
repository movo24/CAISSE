# Runbook — Redeploy du backoffice (`app.addxintelligence.com`) — VERCEL

> ⚠️ **Correction majeure (2026-07-19, incident P0 création produit)** : ce domaine est
> hébergé sur **Vercel**, PAS sur Railway. L'ancienne version de ce runbook (chemin
> dashboard Railway) était obsolète — c'est la cause racine de la dérive de déploiement :
> le front Vercel était resté figé au 5 juin pendant que le backend avançait.
> Détails : `packages/backend/docs/INCIDENT-2026-07-19-P0-creation-produit.md`.

## Topologie réelle (vérifiée 2026-07-19)

| Chose | Où | Notes |
|---|---|---|
| `app.addxintelligence.com` | **Vercel** — team `movo24s-projects`, projet **`addx-backoffice`** (`prj_1Xf2wAEpKCYUyPOvOE2KCVqDpED6`) | + alias `admin.addxintelligence.com` |
| `api.addxintelligence.com` | Railway — projet `sweet-blessing` (workspace movo24), service `backend` | ne PAS toucher sans GO |
| Service Railway `backoffice` (sweet-blessing) | `backoffice-production-90a0.up.railway.app` | ne porte PAS le domaine — ne pas l'utiliser pour ce runbook |
| `VITE_API_URL` (env Vercel Production) | `https://api.addxintelligence.com` | déjà configurée ; le `vercel.json` proxy aussi `/api/*` vers la même cible |

## Procédure (CLI — ~3 minutes)

Depuis un checkout de la branche à déployer :

```bash
cd packages/backoffice-web
vercel login                      # appairage device si session expirée
vercel link --yes --project addx-backoffice --scope movo24s-projects
vercel pull --yes --environment=production   # récupère VITE_API_URL + réglages
vercel build --prod               # build LOCAL (voir piège ci-dessous)
vercel deploy --prebuilt --prod --yes
```

### ⚠️ Piège connu : toujours `--prebuilt`

Le build **distant** (`vercel deploy --prod` sans `--prebuilt`) ÉCHOUE : le script de build
est `tsc --noEmit && vite build`, et les `src/**/*.test.ts` importent `node:fs`/`__dirname`.
En monorepo local, `@types/node` est hoisté depuis la racine → tsc passe ; en install
autonome Vercel, il manque → `error TS2307`. Le build local + `--prebuilt` contourne
proprement sans toucher au code.

## Vérification post-deploy (sans authentification)

```bash
# 1. Le hash du bundle a changé (index-XXXX.js ≠ précédent)
curl -s https://app.addxintelligence.com/ | grep -oE 'index[^"]*\.js'
# 2. Le payload de création est aligné DTO (l'ancien payload cassé a disparu)
curl -s https://app.addxintelligence.com/assets/<bundle>.js | grep -c 'priceMinorUnits'
# 3. SPA + proxy API
curl -s -o /dev/null -w "%{http_code}\n" https://app.addxintelligence.com/products   # 200
curl -s https://app.addxintelligence.com/api/health | head -c 80                     # status ok
```

Puis vérification fonctionnelle authentifiée (owner) : création produit (EAN + prix
« 12,50 » à la virgule), modification titre/prix/TVA/catégorie, affichage immédiat en
liste, persistance après F5 + reconnexion.

## Rollback (2 minutes, sans impact données)

Dashboard Vercel → projet `addx-backoffice` → Deployments → déploiement précédent →
« Instant Rollback » (ou `vercel rollback <url-du-deploy-précédent>`).

## Caches

`index.html` est servi en `must-revalidate` et les assets sont fingerprintés immutables :
un simple rechargement suffit après deploy (pas de purge à faire). Si une vieille UI
persiste chez un client : onglet fermé/rouvert ou Ctrl+F5.
