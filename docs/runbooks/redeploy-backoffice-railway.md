# Runbook — Redeploy du backoffice (Railway)

> Objet : mettre `app.addxintelligence.com` au niveau de `origin/main`.
> Les deploys Railway sont MANUELS (limitation GitHub cross-account). Le
> `serviceId` du service statique backoffice n'est PAS documenté dans le repo
> (seul le service backend l'est) → chemin dashboard ci-dessous ; dès que
> l'owner fournit le serviceId, l'étape CI automatisée pourra être ajoutée.

## Avant (état terrain attendu)
- Création produit → « Erreur de validation » générique (build déployé
  antérieur au fix payload R1 : envoie price/stock/category/cost bruts).
- Dashboard sans logos officiels ; accent indigo.

## Étapes (dashboard Railway — 2 minutes)
1. railway.app → projet CAISSE (workspace `vibrant-freedom`).
2. Ouvrir le service STATIQUE backoffice (pas le backend).
3. Vérifier la variable `VITE_API_URL` = URL Backend B
   (`https://caisse-backend-production.up.railway.app`).
4. Deployments → `⋮` → **Redeploy** (ou Deploy latest commit `main`).
5. Attendre l'état `SUCCESS`.

## Vérification post-deploy
1. Recharger app.addxintelligence.com en vidant le cache (Ctrl+F5).
2. Créer un produit de test : nom + EAN + prix « 12,50 » → doit passer, et
   afficher le prix 12,50 € (preuve virgule) ; le recréer → message précis
   « existe déjà », pas de générique.
3. Dashboard : logos The Wesley's + ADDX visibles, accent magenta.
4. En cas d'erreur de validation : le détail par champ s'affiche sous le
   formulaire (plus jamais « Erreur de validation » seul).

## Rollback (2 minutes)
Deployments → sélectionner le déploiement précédent (encore listé) →
`⋮` → **Rollback to this deployment**. Aucun impact données (front statique).

## Note
Le backend B n'est PAS touché par ce runbook. Toute variable Railway autre
que la vérification en (3) reste hors périmètre (règle : pas de changement
de config sans GO).
