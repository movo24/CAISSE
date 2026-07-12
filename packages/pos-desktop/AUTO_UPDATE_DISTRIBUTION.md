# Distribution & auto-update — The Wesley's POS (dépôt privé)

> Objectif : le **code reste privé**, les **magasins téléchargent sans GitHub**,
> l'**auto-update fonctionne**, et **aucun secret n'est embarqué** dans le `.exe`.

## Pourquoi ce document

Le dépôt `movo24/CAISSE` est **privé**. `electron-updater` ne peut pas lire une
Release GitHub privée sans un **token GitHub embarqué dans l'application** — ce
qu'on ne fait **jamais** (le token serait extractible du `.exe`).

Solution retenue (décision owner) : publier le **feed d'auto-update** sur un
**stockage dédié public en lecture** (Cloudflare **R2** — 1er choix, ou S3),
derrière un domaine du type `https://update.thewesleys.com`. Le `.exe` ne
contient alors qu'une **URL publique**, aucun secret.

```
Release GitHub (privée)   ──►  archive / téléchargement manuel (toi, devs)
Bucket R2 (public read)   ──►  latest.yml + *.exe + *.blockmap  ──►  caisses (auto-update)
```

## Ce que TU dois fournir (une seule fois)

### 1. Un bucket R2 public en lecture
- Crée un bucket R2 (ex. `wesleys-pos-updates`).
- Active l'accès public **en lecture seule** (Public Development URL `*.r2.dev`,
  ou mieux un domaine personnalisé `update.thewesleys.com`).
- L'URL publique de base = **`POS_UPDATE_URL`** (ex.
  `https://update.thewesleys.com` ou `https://pub-xxxx.r2.dev`).

### 2. Des identifiants R2 S3-compatibles (lecture/écriture, pour la CI seulement)
Dans R2 → « Manage API Tokens » → crée un token S3 : tu obtiens
`Access Key ID`, `Secret Access Key`, et l'`endpoint`
`https://<accountid>.r2.cloudflarestorage.com`.

### 3. Les enregistrer dans GitHub (Settings → Secrets and variables → Actions)
| Nom | Type | Valeur |
|-----|------|--------|
| `POS_UPDATE_URL` | **Variable** (public) | URL publique de base du feed (ex. `https://update.thewesleys.com`) |
| `R2_ENDPOINT` | Secret | `https://<accountid>.r2.cloudflarestorage.com` |
| `R2_BUCKET` | Secret | nom du bucket (ex. `wesleys-pos-updates`) |
| `R2_ACCESS_KEY_ID` | Secret | Access Key ID R2 |
| `R2_SECRET_ACCESS_KEY` | Secret | Secret Access Key R2 |

> `POS_UPDATE_URL` est une **variable** (pas un secret) : c'est une URL publique,
> et elle est **bakée dans le `.exe`** (feed d'auto-update). Les 4 autres sont des
> **secrets** utilisés uniquement par la CI pour **téléverser** vers R2 — jamais
> embarqués dans l'application.

## Ce que fait la CI une fois ces valeurs présentes

`.github/workflows/desktop-build.yml` (déclenché par un dispatch `publish=true`
ou un tag `v*`) :

1. Build Windows x64 (quality gate lint + tests + tsc).
2. Si **`POS_UPDATE_URL` est défini** → packe avec le provider **`generic`**
   (feed = `POS_UPDATE_URL`), donc `app-update.yml` (embarqué) pointe vers R2.
3. **Téléverse** `latest.yml`, `*.exe`, `*.blockmap` vers le bucket R2
   (`aws s3 cp --endpoint-url $R2_ENDPOINT`).
4. Crée aussi la **Release GitHub** (archive/manuel).

Tant que `POS_UPDATE_URL` est **absent**, la CI retombe sur le comportement
actuel (Release GitHub uniquement) — donc rien n'est cassé aujourd'hui.

## Résultat pour les magasins

- 1re installation : lien direct `POS_UPDATE_URL/The-Wesleys-POS-Setup-x64.exe`
  (ou la Release GitHub, selon ce que tu diffuses).
- Ensuite : la caisse vérifie `POS_UPDATE_URL/latest.yml` au démarrage puis ≤ 24 h,
  télécharge et installe **hors vente** — sans GitHub, sans token, sans secret.

## Signature de code Windows (séparé, plus tard)

Non lié à R2. Nécessite un **certificat de signature** (secret owner). Sans lui,
SmartScreen affiche « Éditeur inconnu ». La config `electron-builder` est prête
à recevoir la signature (secrets `CSC_LINK` / `CSC_KEY_PASSWORD`) sans
restructuration.
