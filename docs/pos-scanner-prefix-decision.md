# Décision — préfixe sur la douchette Lenvii E655 ? (choix fermé, owner tranche)

> Contexte : une douchette clavier-wedge « tape » le code comme un clavier. Le **1er caractère**
> est le seul indiscernable d'une frappe humaine (aucun écart de temps disponible avant le 2ᵉ).
> Deux façons de traiter ce caractère.

## Option (a) — **sans préfixe** (état actuel, livré et prouvé)

Détection par la **vitesse** ; le 1er caractère est laissé passer, puis **retiré du champ** dès que le
scan est identifié (à l'`Entrée`).

- ✅ **Zéro caractère résiduel** — prouvé par le test DOM (`input.value` vide après scan ; contenu
  préexistant `"AB"` préservé).
- ✅ **Aucune configuration matérielle** ; fonctionne avec n'importe quelle douchette clavier-wedge.
- ✅ Frappe humaine intacte, raccourcis non interceptés (prouvé).
- ⚠️ Résiduel **transitoire** : si un champ texte a le focus pendant un scan, 1 caractère peut
  apparaître puis disparaître en quelques dizaines de ms (cosmétique, rien ne reste).

## Option (b) — **préfixe configuré** sur la douchette

La douchette est configurée (code-barres de configuration constructeur) pour préfixer chaque scan d'un
caractère distinctif. Le scan est alors reconnu **dès le 1er caractère** → rien n'est jamais inséré.

- ✅ Déterministe dès le 1er caractère : **pas même le flash transitoire**.
- ❌ **Opération matérielle sur chaque douchette** — à refaire à chaque unité neuve, remplacée ou
  réinitialisée en usine.
- ❌ **Couplage au modèle/firmware** (le code de config dépend du constructeur).
- ❌ Une douchette dé-configurée silencieusement retombe sur le comportement (a) → l'écart devient
  invisible en support (pas de panne, juste le flash qui revient).
- ❌ Nécessite en plus du **code** (support du préfixe) → surface à maintenir, pour un gain cosmétique.

## Recommandation : **(a) — rester sans préfixe**

Motif : **il n'y a plus d'écart de correction à combler**. Le retrait du 1er caractère est déjà prouvé
(zéro résiduel, contenu préexistant préservé). L'option (b) n'achète **aucune correction**, seulement la
suppression d'un **flash transitoire d'un caractère**, au prix d'une dépendance matérielle récurrente
(config par unité) et d'un couplage au modèle — c'est-à-dire une dette opérationnelle permanente contre
un gain cosmétique.

**Condition de réouverture** : si le test physique (scénarios ② / ⑤ de `pos-scanner-field-test.md`)
montre que le flash est réellement visible/gênant en usage, ou qu'un modèle de douchette se comporte
différemment, (b) reste ajoutable **en surcouche** — la détection par la vitesse resterait le repli si
le préfixe manque. Décision à prendre **après** le test physique, pas avant.

**Décision owner** : ☐ (a) sans préfixe — ☐ (b) préfixe — Date : __________
