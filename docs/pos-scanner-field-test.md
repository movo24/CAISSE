# Test physique — douchette USB Lenvii E655 (caisse Windows)

> **À dérouler par un humain, sur la caisse Windows, douchette branchée.**
> Ces tests **n'ont pas été exécutés** par l'agent : la douchette n'est pas branchée sur le Mac.
> La validation automatisée (jsdom, séquence clavier reproduite) est complète et verte, mais elle
> **ne prouve pas le matériel**. Ce document est la checklist qui le prouve.

## Version à tester

| | |
|---|---|
| **Commit** | **`124f91c`** (`124f91c59fc38935ba36cf68b6c627792d891901`) |
| **Branche** | `feat/pos-wedge-scanner` (sur `origin`) |
| **Statut** | ⚠️ **NON mergée dans `main`** → **non distribuée** par le canal normal |

⚠️ **Important** : la caisse se met à jour via **electron-updater + GitHub Releases** (`latest.yml`).
Une branche non mergée **n'arrive jamais** par ce canal. Une caisse qui s'est auto-mise-à-jour exécute
donc **`main`**, PAS ce correctif. Pour tester, il faut **installer manuellement** un build de la branche.

## Mise en place

```bash
# 1. Récupérer EXACTEMENT le commit à tester
git fetch origin
git checkout 124f91c
git rev-parse HEAD      # DOIT afficher : 124f91c59fc38935ba36cf68b6c627792d891901

# 2. Construire l'installeur Windows
npm ci
cd packages/pos-desktop
npm run desktop:build:win     # → installeur dans packages/pos-desktop/release/
```
Installer l'artefact produit sur la caisse. Noter le **nom de fichier + date/heure de build**.

⚠️ **La version affichée reste `1.1.0`** (non bumpée) → elle **ne permet PAS** de distinguer ce build
de `main`. Utiliser l'**Étape 0** ci-dessous comme discriminant réel.

### Étape 0 — vérifier qu'on teste bien le bon build (discriminant)

Placer le curseur dans un **champ texte** de la caisse (ex. champ de recherche), puis **scanner un article**.

- **Le code reste écrit dans le champ** → ❌ **c'est l'ancien build (`main`)** : le correctif n'est pas installé. **Arrêter**, réinstaller.
- **Le champ reste vide et l'article est ajouté** → ✅ le build `124f91c` est bien en place. Continuer.

---

## Checklist (cocher + noter le résultat observé)

| # | Scénario | Manipulation | Résultat ATTENDU | OK / KO | Observé |
|---|----------|--------------|------------------|---------|---------|
| ① | **Scan simple** | Écran de caisse, caissier connecté, **sans cliquer dans un champ**. Scanner un article actif connu. | Article **ajouté au panier** (nom, prix TTC, quantité 1) ; **champ de recherche vide** ; indicateur « Produit ajouté » ; écran client à jour. | ☐ | |
| ② | **Scan curseur dans un champ texte** | Cliquer dans un champ texte (recherche, ou motif/e-mail si ouvert) pour qu'il ait le focus. Scanner un article. | Article **ajouté au panier** ; **zéro caractère résiduel** dans le champ (rien ne reste écrit). | ☐ | |
| ③ | **2 scans du même article** | Scanner l'article, l'éloigner, le re-présenter et scanner à nouveau. | **Une seule ligne**, **quantité 2** (la 2ᵉ lecture n'est PAS supprimée). | ☐ | |
| ④ | **2 articles différents rapprochés** | Scanner l'article A puis, immédiatement, l'article B. | **2 lignes distinctes** (A et B), quantités 1 chacune. | ☐ | |
| ⑤ | **Frappe humaine dans un champ** | Cliquer dans le champ de recherche et **taper au clavier** un nom/code, normalement. | Le texte **s'écrit normalement** (aucun caractère perdu, aucune latence anormale) ; la recherche fonctionne. | ☐ | |
| ⑥ | **Entrée du scan → aucun submit parasite** | Scanner un article alors qu'un champ/formulaire a le focus. | **Aucun** envoi de formulaire, **aucun** déclenchement de paiement ni action inattendue ; seul l'ajout au panier a lieu. | ☐ | |
| ⑦ | **Raccourcis non interceptés** | Dans un champ : `Ctrl+A`, `Ctrl+C`, `Ctrl+V`. Puis hors champ : `Échap`, `F8`, `F9`. | Raccourcis **fonctionnent normalement** (sélection/copier/coller ; Échap ferme, F8 vide le panier si droit, F9 historique). | ☐ | |
| ⑧ | **Double émission parasite** *(si observable)* | Scanner **une seule fois** un article et observer. | **Un seul ajout** (quantité +1, jamais +2 pour un seul geste). Si la douchette ré-émet le code, la 2ᵉ émission (<50 ms) est ignorée. | ☐ | |

### Contrôles transverses (à vérifier pendant le déroulé)
- ☐ Après un **paiement terminé** puis nouveau panier → le scan fonctionne toujours (refaire ①).
- ☐ Après **fermeture d'une modale** (poids, produit inconnu, e-mail) → le scan fonctionne toujours.
- ☐ **Code inconnu** scanné → message « Code inconnu » + modale produit inconnu, **aucun produit créé**.
- ☐ **Produit désactivé** scanné → **refus** avec motif, aucune ligne ajoutée.
- ☐ **Réseau coupé** → un article du catalogue local synchronisé s'ajoute quand même.

---

## En cas de KO

Noter : le **scénario**, ce qui a été **observé**, le **code-barres** utilisé, et si possible une **photo/capture**.
Ne pas modifier la caisse. Remonter tel quel — le correctif se fait sur la branche, pas en production.

**Testeur** : ____________________  **Date** : ____________  **Build installé (fichier/date)** : ____________________
