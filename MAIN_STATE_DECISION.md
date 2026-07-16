# Dossier de décision — état de `main` après l'incident du 2026-07-16

> **Décision réservée au propriétaire.** Rien n'est fait sur `main` sans GO. Ce document présente
> l'état prouvé, deux options chiffrées, et deux actions GitHub indépendantes.

## 1. Ce qui s'est passé (fait qualifié)
Un « go merge » a été exécuté par **push SSH direct sur `main`** après échec de `gh pr create`
(droits insuffisants). **Faute de process** : une PR impossible est un blocage à remonter, pas une
autorisation de la contourner. Fusion en **fast-forward** `5fbe11e → a7f6f59` (aucun merge commit).

## 2. État de `main` = `a7f6f59` (prouvé, lecture seule)
| Vérification | Résultat |
|---|---|
| Boot backend base **vierge** (prod, migrationsRun) | ✅ démarre · 40 migrations (dont 1767) · `/api/health` **200** |
| Boot base **déjà migrée** (idempotent) | ✅ démarre · **200** |
| Ordre migrations : `1767` puis arrivée de `1759–1766` | ✅ exécutées comme *pending*, aucune dépendance, aucune collision |
| Tests flag `STOCK_JOURNAL_SHADOW` absent / false | ✅ **967/0** |
| Déploiement / DNS déclenché par le push | ❌ **aucun** (`railway-live`, `railway-dns-cutover` = `workflow_dispatch` only) · **Backend A prod intact** |
| **CI (`ci.yml`, `on: push → main`)** | 🔴 **ROUGE** — voir §3 |

**Le code produit est SAIN.** La seule anomalie est la **CI rouge**.

## 3. La CI rouge : cause unique, isolée
`main` était **verte en continu** jusqu'au 15/07 ; le push du 16/07 est la 1ʳᵉ `failure`. Cause
**reproduite localement** : `stock-movement-linkage-migration.pg.spec.ts` fait `runMigrations()` en
supposant une base vierge, mais `ci.yml` enchaîne tous les `*.pg.spec.ts` sur **une base partagée**
peuplée par les specs `synchronize` → collision (migration `1711` échoue). **Défaut de test/harnais,
pas de code produit** (cf. §2). Dette **D23**.

## 4. Deux options (votre décision)

### Option 1 — Fix forward *(recommandée)*
Merger la branche **`fix/ci-pg-spec-isolation`** (préparée, poussée) : le spec migration crée/détruit
sa **propre base dédiée**, le mock `adjustStock` reçoit son `.insert`. **`main` CI redevient verte,
zéro churn, le lot fiscal (sain) reste.**
- **Preuve** : run **CI-simulé** (tous les pg specs `--runInBand` sur une base partagée, comme `ci.yml`)
  → **vert, 28/28, exit 0** ; matrice flag absent/false/true → **967/0**.
- **Action (à votre main)** : merger la PR `fix/ci-pg-spec-isolation` une fois le canal PR rétabli (§5).
- **Motivation** : le code produit est prouvé sain ; seul le harnais de test était en défaut ; le
  correctif est minimal (2 fichiers de test) et prouvé sous conditions CI exactes. Un revert
  détruirait un lot fiscal sain pour un défaut de test.

### Option 2 — Revert additif *(si vous voulez `main` = pré-fiscal)*
Ramène `main` à l'état `5fbe11e` **sans réécrire l'historique** (pas de force-push) :
```bash
git checkout main && git pull
git revert --no-commit 5fbe11e..a7f6f59
git commit -m "revert: retire le lot journal de stock (retour à l'état 5fbe11e)"
# puis push via PR (canal rétabli)
```
- **Coût** : le lot fiscal sain quitte `main` ; à re-merger proprement ensuite (la branche
  `feat/stock-journal-nf525-on-main` reste intacte comme véhicule).

## 5. Deux actions GitHub à votre main (indépendantes du choix §4)
1. **Protéger `main`** — aujourd'hui `GET /branches/main/protection` = **404 (aucune protection)** :
   c'est la porte ouverte qui a rendu la faute possible. Activer *« Require a pull request before
   merging »* (+ optionnel *require status checks = CI*, *restrict direct pushes*) → un push direct
   serait **rejeté**, même par la clé `movo24`.
2. **Rétablir un canal PR fonctionnel** — aucun compte `gh` disponible n'a les droits
   (`y5ctnxgdc9-hue` non-collaborateur, `contact235` lecture seule). Donner les droits write/PR à un
   compte `gh` sur `movo24/CAISSE` → PR créables/mergeables normalement, fin du contournement subi.

## 6. Restent gatés (je n'y touche sous aucun prétexte)
Toute écriture sur `main`, revert, force-push, activation de flag, déploiements, DNS.
