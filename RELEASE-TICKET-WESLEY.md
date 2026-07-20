# Release — Refonte ticket de caisse The Wesley

> Mis à jour le 2026-07-18 après enquête sur le canal de mise à jour réel.
> **Chaque étape marquée [GO] exige un GO owner nominatif, dans l'ordre.**
>
> Branches (poussées, non mergées) :
> - `fix/tva-taxrate-string` — correction TVA (commit `ccfb129`)
> - `feat/ticket-wesley` — chantier ticket complet (v1.2.0 prête à publier)

---

## Canal de mise à jour des caisses — état FACTUEL (enquête 2026-07-18)

- Les caisses se mettent à jour **automatiquement via GitHub Releases**
  (electron-updater, provider `github`) : 12 releases v1.0.0 → v1.1.0 publiées
  du 11 au 14 juillet par `desktop-build.yml` (workflow_dispatch + publish
  depuis `main`). **Ce canal fonctionne toujours** (dépôt public, `latest.yml`
  accessible anonymement — vérifié).
- La caisse test ne reçoit pas le nouveau ticket **uniquement** parce qu'aucune
  release n'a été publiée depuis v1.1.0 : le code vit sur une branche.
- **R2 n'est PAS nécessaire aujourd'hui.** `AUTO_UPDATE_DISTRIBUTION.md` a été
  écrit sur l'hypothèse « dépôt privé » — hypothèse fausse actuellement.
  R2 ne redevient d'actualité QUE si le dépôt repasse en privé (voir « Sujet
  futur » en bas) — et devra alors être en place AVANT le passage en privé.

## Le chemin (5 étapes, workflow existant)

### 1. [Owner] Ouvrir et contrôler les deux PRs
La création de PR est impossible pour le compte CI local (`y5ctnxgdc9-hue`,
« must be a collaborator ») — à ouvrir via ces liens :
- PR n°1 (TVA) : <https://github.com/movo24/CAISSE/compare/main...fix/tva-taxrate-string>
- PR n°2 (ticket) : <https://github.com/movo24/CAISSE/compare/main...feat/ticket-wesley>

⚠️ Le bug TVA a aussi été traité par la session parallèle du chip
(`claude/clever-chaplygin-e95712`) : **ne merger qu'UNE des deux corrections**.

### 2. [GO] Merger la PR n°1 (TVA) en premier
La page publique du ticket affiche une ventilation TVA juste ; sans ce fix,
elle divergerait du `tax_total` stocké (faux) des nouvelles ventes.

### 3. [GO] Merger la PR n°2 (ticket)
⚠️ La migration 1771 (additive, réversible) s'appliquera automatiquement au
boot du backend **prod** au premier déploiement suivant (`migrationsRun: isProd`).
Le déploiement Railway reste manuel et séparé (RUNBOOK) — le ticket papier de
la caisse ne dépend PAS de ce déploiement (seuls le QR/page publique en
dépendent).

### 4. [GO] Publier la v1.2.0 (workflow existant — comme les 12 fois précédentes)
- La version `1.2.0` est déjà bumpée dans `packages/pos-desktop/package.json`
  sur la branche → présente dans `main` après merge.
- GitHub → Actions → « Build POS Caisse Desktop (.exe) » → **Run workflow**
  (branch `main`, `publish = true`). La CI construit, crée la Release v1.2.0
  avec `latest.yml` + Setup + blockmap.

### 5. Laisser la caisse test se mettre à jour seule
Détection au démarrage puis ≤ 24 h ; téléchargement en arrière-plan ;
installation hors vente (fermeture de l'app ou « installer maintenant » quand
la caisse est au repos). Preuve : la version affichée dans l'app passe à
1.2.0 (+ journal `userData/updates.log`).

## Après la mise à jour de la caisse (pour voir le ticket complet)
- Le nouveau ticket papier (logo officiel, TVA, mentions) s'imprime dès la
  v1.2.0, sans aucune configuration.
- Le **QR / ticket numérique** exige en plus : backend déployé (migration 1771)
  + « Base URL publique » renseignée dans Dashboard → Ticket de caisse.
  Sans cela, le ticket imprime la note « après synchronisation » — voulu,
  jamais bloquant.
- Configurer le vrai magasin (Créteil Soleil) dans le Dashboard : identité
  légale + logo (bouton « logo officiel ») + phrases (badges « information à
  compléter »).

## Sujet futur (décision owner, hors périmètre de cette release)
Le dépôt est **public** → le code source de la caisse est visible de tous.
Si passage en privé souhaité : installer d'abord le pipeline R2
(`AUTO_UPDATE_DISTRIBUTION.md`, CI déjà câblée — il ne manque que la variable
`POS_UPDATE_URL` et les 4 secrets R2, à saisir DIRECTEMENT dans GitHub,
jamais via une conversation), publier une version « pont » dont le feed pointe
vers R2, attendre que toutes les caisses l'aient installée, PUIS passer le
dépôt en privé.

### Garde-fous
- Aucune vente historique réécrite (immutabilité NF525) ; note comptable
  corrective TVA = décision owner séparée.
- Chaque [GO] est indépendant : un GO n'en ouvre jamais un autre.
