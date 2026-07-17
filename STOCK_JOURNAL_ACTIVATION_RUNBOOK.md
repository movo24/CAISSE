# Runbook — activation du double-run `STOCK_JOURNAL_SHADOW`

> **Exécution mécanique** une fois le GO owner « activation flag \<env\> » donné.
> **Aucune activation hors environnement de test local n'est autorisée sans ce GO nominatif**
> (Tier-2). Ce document ne l'active pas ; il rend l'exécution sans ambiguïté quand le GO tombe.
> Prérequis livrés : F0, F1, F1b, F2 sur `feat/stock-journal-nf525-on-main`.

---

## 1. La variable, et où la poser

| Élément | Valeur |
|---|---|
| Nom | `STOCK_JOURNAL_SHADOW` |
| Valeur d'activation | `true` (toute autre valeur, ou absente = **OFF**) |
| Lu par | `sales.service.ts` (vente/void), `returns.service.ts` (retour), `stock.service.ts` (ajustement) — `process.env.STOCK_JOURNAL_SHADOW === 'true'`, évalué **à chaque opération** (pas de cache, pas de reboot requis pour un futur OFF) |

**Où, par environnement — ordre imposé (jamais la prod en premier) :**
1. **Local / test** : `.env` backend ou inline (`STOCK_JOURNAL_SHADOW=true npm run …`). Libre (déjà utilisé par les specs gated).
2. **Backend B — sandbox Railway** (`vibrant-freedom`, `caisse-backend-production.up.railway.app`) : variable de service Railway. **C'est ici que se fait le vrai double-run.** GO « activation flag sandbox ».
3. **Backend A — prod canonique** (`api.addxintelligence.com`) : **NE PAS TOUCHER** sans un GO explicite et distinct, et seulement après F3 (bascule) validée. L'activation seule y est inutile (rien ne lit le journal avant F3) et introduit une écriture en prod sans bénéfice.

Railway = deploy manuel (cf. `RUNBOOK.md`) ; poser la variable **ne** redéploie pas le code, mais l'instance doit être relancée pour recharger l'env (Railway le fait à la mise à jour de variable).

## 2. Effet précis à l'activation (ce qui écrit quoi)

Aucune lecture ne change — la caisse lit **toujours** `products.stock_quantity`. En plus, dans la **même transaction** que l'opération métier :

| Opération | Mouvement(s) `stock_movements` ajouté(s) | `sale_id` ? |
|---|---|---|
| Vente ligne simple | `sale` (−qty) par ligne | oui (idempotent via index F0) |
| Vente pack | `sale` (parent) + `pack_consumption` par composant | oui |
| Retour | `return_customer` (+qty) parent + composants | non (lié par `reference`+`note`) |
| Void | `void` (+qty) parent **et** composants (fix G3) | oui |
| Ajustement | `inventory_adjust` (**delta signé**) ; delta nul → rien | non |

Le **hash de vente reste inchangé** (mouvement écrit après le hash, hors allowlist). `fiscal_journal`, `credit_notes`, `audit` intacts.

## 3. Surveillance (l'instrument)

Outil : `packages/backend/scripts/stock-reconcile.js` (lecture seule stricte — `BEGIN TRANSACTION READ ONLY`).

```bash
# Mesure de référence (juste après activation) :
node scripts/stock-reconcile.js --url "$DATABASE_URL" --snapshot recon-$(date +%F).json
# Mesures suivantes, comparées à la précédente :
node scripts/stock-reconcile.js --url "$DATABASE_URL" \
     --baseline recon-<précédent>.json --snapshot recon-<aujourdhui>.json
```

- **Rapport** : par (magasin, produit) → `scalar`, `journal_sum`, `gap`, **`Δgap`** (variation vs baseline). Une ligne `⚠ NON JOURNALISÉ` marque un produit dont le `gap` a bougé.
- **Cadence** : au moins **1×/jour** pendant la fenêtre, **+ 1 mesure juste après chaque pic** (weekend, promo). `--json` pour archivage/CI.
- **Codes retour** : `0` = aucune variation > seuil ; `2` = variation(s) détectée(s) (à investiguer) ; `1` = erreur. Le seuil par défaut est `0` (strict) ; `--threshold N` pour tolérer un bruit connu.
- **Seuil d'alerte** : toute sortie **exit 2** = investigation. Attendu tant que **F4** n'est pas livré : les variations imputables au **système B legacy** (`syncLegacyStock`, réception/transfert/perte par emplacement) sont **explicables** — les corréler aux opérations d'entrepôt. Une variation **sans** opération d'entrepôt correspondante = anomalie réelle (correction manuelle en base, ou bug).

## 4. Rollback

`STOCK_JOURNAL_SHADOW` absent/≠`true` ⇒ **retour immédiat à l'identique** : plus aucun mouvement écrit, lectures déjà inchangées. **Aucune donnée à défaire** — les mouvements déjà écrits sont append-only et inertes (personne ne les lit avant F3). Preuve que OFF = comportement d'origine : suite pg-mem **967/0** flag OFF + 4 specs fiscales gated vertes flag OFF (avoir-atomicité, fiscal-verifier, packs, anti-survente) — c'est l'état commité par défaut.

## 5. Critère de sortie de fenêtre (recommandation pour le N de F3-c)

> Décision owner. Recommandation **motivée par le volume, pas le calendrier** :

**Sortir quand TOUTES ces conditions sont réunies :**
1. **Couverture des chemins** : chaque chemin journalisé a **réellement tiré** en volume non trivial — ventes (dont **packs**), **retours**, **voids**, **ajustements**. Un `void`/`adjust` qui n'a jamais firé n'a rien prouvé.
2. **Volume représentatif** : ≥ le volume de ventes d'un **cycle d'activité complet** du magasin (typiquement ~2 semaines) **incluant au moins un pic** (weekend/promo) — la concurrence des pics est ce qui casse les invariants, pas les jours calmes.
3. **Durée plancher** : ≥ **14 jours** calendaires (garde-fou minimal), la condition 2 primant si elle est plus longue.
4. **0 variation de gap INEXPLIQUÉE** sur toute la fenêtre : chaque `Δgap ≠ 0` est corrélé à une opération **système B legacy** (attendu jusqu'à F4). Aucune variation orpheline.

**Pourquoi pas « N jours » seuls :** une quinzaine creuse passerait à 0 divergence sans rien prouver ; les chemins rares (void, adjust) risquent de ne jamais firer ; les pics ne seraient pas éprouvés. Volume + couverture des chemins + un pic = « 0 divergence » qui a du sens.

Une fois ce critère tenu → dossier **F3** (bascule + cutover `opening_balance`), décisions (a)/(b)/(c) dans `GO_F2_PACKAGE.md`.

---

**Restent gatés (GO nominatif)** : activation du flag hors test local, F3, F4, tout merge.
