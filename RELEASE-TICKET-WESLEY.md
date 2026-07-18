# Release — Refonte ticket de caisse The Wesley

> Dossier de mise en production préparé le 2026-07-18. **Chaque étape marquée
> [GO] est un gate Tier-2 : action owner explicite, dans l'ordre.** Rien ici ne
> s'exécute tout seul ; ce document est la checklist exacte.
>
> Branches concernées (poussées, non mergées) :
> - `fix/tva-taxrate-string` — correction TVA (commit `ccfb129`)
> - `feat/ticket-wesley` — chantier ticket complet (commits `2cf4061`, `3d656d6`, `0e19c1a`, + ce dossier)

---

## 0. Pré-requis constatés

- La création de PR est **impossible avec le compte CI local** (`y5ctnxgdc9-hue`,
  « must be a collaborator ») → les PRs doivent être **ouvertes par l'owner**
  (liens pré-remplis ci-dessous). Jamais de push direct sur `main` (règle 11).
- ⚠️ Le bug TVA a AUSSI été traité par la session parallèle du chip
  (`claude/clever-chaplygin-e95712`, commit `ac9286e`) : **ne merger qu'UNE des
  deux corrections** (recommandation : comparer, garder celle avec le spec pg
  RED→GREEN + chaîne CI complète, fermer l'autre).

## 1. [GO] PR n°1 — correction TVA (à merger EN PREMIER)

Ouvrir : <https://github.com/movo24/CAISSE/compare/main...fix/tva-taxrate-string>

Pourquoi en premier : la page publique du ticket affiche une ventilation TVA
calculée juste ; sans ce fix, elle divergerait du `tax_total` stocké (faux) des
nouvelles ventes.

Contenu : transformer `decimalToNumber` sur les colonnes de taux + normalisation
défensive au site de calcul (`sales.service.ts`). Formule/arrondis inchangés.
Preuves : spec pg RED (7c ≠ 253c) → GREEN sur vrai Postgres ; chaîne pg CI
11 suites / 29 tests verts ; 972 tests unitaires verts.

Reste ouvert après merge (décision owner séparée, jamais d'UPDATE) : note
comptable corrective pour les ventes historiques scellées avec une TVA fausse.

## 2. [GO] PR n°2 — chantier ticket The Wesley

Ouvrir : <https://github.com/movo24/CAISSE/compare/main...feat/ticket-wesley>

Contenu (une seule branche, comme demandé) :
- **Migration 1771** (additive, réversible) : réglages ticket sur `stores` +
  `sales.public_token` (nullable, unique partiel, HORS hash fiscal).
  ⚠️ Tier-2 : elle **s'appliquera automatiquement au boot du backend prod**
  (`migrationsRun: isProd`) au premier déploiement après merge.
- Jeton public par vente (rejeu idempotent = même jeton) ; page publique
  `/ticket/:jeton` (HTML mobile Wesley + JSON + PDF + recommandations catalogue
  réel), throttle dédié, 404 opaque, zéro PII journalisée.
- Moteur ticket papier 58/80 mm : logo N&B, mentions légales dynamiques,
  qté × PU, remises, sous-total, ventilation TVA par taux, TOTAL TTC,
  reçu/rendu, phrase + formule de fin, QR (natif ESC/POS `GS ( k`), accents
  CP1252 ; hors ligne = note claire, jamais bloquant.
- Dashboard → Paramètres → Magasins → **Ticket de caisse** : logo (bouton
  « logo officiel » + import), textes, QR, recommandations, aperçu 58/80 mm,
  ticket de test « TEST — SANS VALEUR FISCALE », badges « information à
  compléter », audit old/new de chaque modification.
- Logo officiel The Wesley versionné (pos-desktop + backoffice) ; écran client
  et repli ticket.

Preuves : 995 tests backend verts + chaîne pg CI (avec mig 1771 réellement
exécutée), 370 tests POS verts, captures 58/80 mm + page mobile + Dashboard,
PDF téléchargé, QR généré puis décodé (contenu exact), rejeu = même jeton,
2 ventes = 2 jetons.

## 3. [GO] Déploiement backend (Backend B uniquement)

- **Backend A (`api.addxintelligence.com`) : NE PAS TOUCHER** sans GO dédié.
- Backend B (Railway `vibrant-freedom`) : déploiement **manuel** —
  `serviceInstanceDeployV2(commitSha: "<sha du merge>")` (curl exacts dans
  `packages/backend/RUNBOOK.md`).
- Au boot : la migration 1771 s'applique (additive ; rollback = `down()`).
- Vérifier ensuite : `GET /api/health` → 200 ; une vente de test → réponse avec
  `publicToken` ; `GET /ticket/<jeton>` → page ; TVA de la vente test correcte.

## 4. [GO] Configuration du vrai magasin (Dashboard)

Dashboard → Paramètres → Magasins → Ticket de caisse, magasin
**The Wesley — Créteil Soleil** (aucune donnée réelle n'existe dans le repo —
tout est à saisir par l'owner) :
1. Fiche magasin : raison sociale exploitante, adresse complète, SIRET,
   téléphone, e-mail, TVA intracom, RCS, capital (les badges « information à
   compléter » guident ; une donnée absente n'est PAS imprimée).
2. Page Ticket de caisse : bouton « Utiliser le logo officiel The Wesley »,
   phrase de fin, formule, texte QR, recommandations (destination),
   **Base URL publique** = domaine servant `/ticket/:jeton` (Backend B tant que
   Backend A est gelé).
3. Aperçu 58/80 mm + « Imprimer un ticket de test » (marqué TEST — SANS VALEUR
   FISCALE) pour valider visuellement.

## 5. [GO] Mise à jour des caisses (auto-update R2)

Réf. complète : `packages/pos-desktop/AUTO_UPDATE_DISTRIBUTION.md`. La CI
(`.github/workflows/desktop-build.yml`) est prête ; il manque UNIQUEMENT les
valeurs owner (une fois) :
1. Créer le bucket R2 public lecture (ex. `wesleys-pos-updates`) + token S3.
2. GitHub → Settings → Secrets and variables → Actions :
   - Variable `POS_UPDATE_URL` (URL publique du feed) ;
   - Secrets `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`,
     `R2_SECRET_ACCESS_KEY`.
3. Après merge : bump de version pos-desktop puis tag `desktop-v<version>`
   (ou dispatch `publish=true`) → build Windows signéable, upload
   `latest.yml` + `.exe` + `.blockmap` vers R2, Release GitHub archivée.
4. Caisses : 1ʳᵉ installation via `POS_UPDATE_URL/The-Wesleys-POS-Setup-x64.exe`,
   ensuite auto-update ≤ 24 h, hors vente.

## 6. Validations physiques (magasin)

- Impression réelle 58 mm et 80 mm (logo net et centré, accents, noms longs).
- Scan du QR au téléphone → page mobile ; téléchargement PDF.
- Vente espèces / carte / mixte ; remise ; avoir/remboursement (statut affiché
  sur la page sans réécrire le ticket) ; vente hors ligne → sync → réimpression
  avec QR ; deux magasins → configurations et jetons indépendants.

---

### Rappels de garde-fous
- Aucune vente historique réécrite, jamais (immutabilité NF525).
- Le QR ne remplace pas le numéro fiscal du ticket ; l'encaissement ne dépend
  jamais du site ; aucun tracking sur la page publique.
- Chaque [GO] ci-dessus est indépendant : un GO n'en ouvre jamais un autre.
