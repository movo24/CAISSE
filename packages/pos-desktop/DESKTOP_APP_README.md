# POS Caisse — Application Desktop

Application de caisse installable (Windows en priorité, macOS secondaire),
**utilisable sans ligne de commande** par un non-développeur : on double-clique,
le logiciel s'ouvre dans sa propre fenêtre, sans navigateur ni console.

Elle est construite avec **Electron** par-dessus le front-end web existant
(aucune réécriture du POS). Le front est servi en interne via un protocole
`app://`, ce qui fait fonctionner le routage de l'app sous packaging.

---

## 0. Prérequis matériels & système

Cible officielle du poste de caisse **double écran** (caisse tactile + écran client vertical 9:16).

| Élément | Recommandation |
|---|---|
| **Système d'exploitation** | **Windows 11 x64** recommandé (Windows 10 x64 accepté). L'artefact est compilé pour **win x64**. |
| **RAM** | **8 Go** recommandés (4 Go minimum). |
| **Stockage** | **SSD, 128 Go minimum** (le SSD est requis pour un démarrage et une lecture vidéo fluides). |
| **Sorties vidéo** | **Deux sorties vidéo requises** pour le double écran (ex. HDMI + HDMI/DisplayPort, ou USB-C + HDMI). L'écran client se place sur la 2ᵉ sortie. |
| **Écran opérateur** | **Écran tactile compatible Windows HID/USB** (le tactile est géré nativement par Windows ; aucun pilote spécifique côté app). |
| **Écran client** | Écran **non tactile**, orienté **portrait 9:16** (rendu natif 1080×1920, responsive 720×1280 / 1440×2560). |
| **Imprimante ticket / scanner** | **À tester séparément** selon le modèle (USB/série/Bluetooth). L'intégration périphérique n'est pas couverte par cette validation double-écran — voir §10. |

> L'écran client ne pilote **jamais** l'encaissement : il affiche uniquement. Une
> seule sortie vidéo suffit à faire tourner la caisse ; la 2ᵉ sortie n'active que
> l'écran client.

---

## 1. Pourquoi Electron (et pas Tauri / PWA)

Décision pragmatique, pas théorique : Electron était **déjà** une dépendance du
projet (`src/main/index.ts`, champ `main` dans `package.json`). Le compléter est
la voie **la plus rapide, stable et maintenable** et produit un vrai `.exe`.
Tauri aurait imposé une réécriture (Rust) ; une PWA seule ne donne pas un `.exe`
double-cliquable ni l'accès périphériques desktop.

---

## 2. Générer l'application

### Option A — sans machine Windows (recommandé) : CI GitHub

Un workflow construit le `.exe` sur les serveurs Windows de GitHub.

1. Pousser la branche, aller dans l'onglet **Actions** du repo.
2. Lancer **« Build POS Caisse Desktop (.exe) »** (bouton *Run workflow*).
   - Champ optionnel `api_url` : l'URL d'API à intégrer (vide = API de prod).
3. À la fin, télécharger l'artefact **`POS-Caisse-Windows`** : il contient
   - `POS-Caisse-Setup-<version>.exe` (installateur)
   - `POS-Caisse-Portable-<version>.exe` (portable)
4. (Optionnel) Pousser un tag `desktop-v0.1.0` → le `.exe` est attaché à une
   **Release** GitHub automatiquement.

> Fichier workflow : `.github/workflows/desktop-build.yml`

### Option B — sur un PC Windows

```bash
cd packages/pos-desktop
npm install
npm run desktop:build:win
```

### Option C — sur macOS (preuve / usage Mac)

```bash
cd packages/pos-desktop
npm install
npm run desktop:build:mac
```

---

## 3. Où récupérer le fichier final

Tout est généré dans **`packages/pos-desktop/release/`** :

| Fichier | Usage |
|---|---|
| `POS-Caisse-Setup-<version>.exe` | Installateur Windows (raccourci bureau + menu démarrer) |
| `POS-Caisse-Portable-<version>.exe` | Version portable Windows (voir §6) |
| `POS Caisse-<version>.dmg` / `.app` | macOS |

---

## 4. Installer (utilisateur final)

**Installateur** : double-cliquer sur `POS-Caisse-Setup-<version>.exe`, choisir
le dossier si besoin, terminer. Un raccourci **POS Caisse** apparaît sur le
bureau et dans le menu Démarrer.

**Aucun prérequis** : pas de Node, pas de Docker, pas de terminal. Tout est
embarqué dans l'exécutable.

---

## 5. Configurer l'URL de l'API

L'app parle à l'API POS Caisse existante. L'URL se choisit **au moment du build**
(jamais de secret en dur — voir `.env.example`).

- **Local/dev** : laisser `VITE_API_URL` vide → proxy Vite vers `localhost:3001`.
- **Desktop packagé** : si `VITE_API_URL` est vide, l'app utilise par défaut
  `https://api.addxintelligence.com` (voir `src/renderer/utils/apiConfig.ts`).
- **Staging/prod** : définir `VITE_API_URL` avant le build (dans `.env`, ou via
  le champ `api_url` du workflow CI).

```bash
# packages/pos-desktop/.env
VITE_API_URL=https://api.example.com
```

Trois environnements possibles (dev / staging / prod) en changeant cette seule
variable. **Aucune clé API n'est stockée dans le code ni dans le bundle.**

> ⚠️ **IMPORTANT — par défaut, le build pointe vers la PROD.**
> `desktop:build:mac` / `:win` (sans `VITE_API_URL`) produisent une app qui
> parle à l'**API de production**. Ne **jamais** faire de tests transactionnels
> (vente, retour, avoir, clôture) avec ce build : ce sont de **vraies données**.
>
> Pour la QA, builder une app **staging** dédiée :
> ```bash
> # macOS
> STAGING_API_URL="https://staging.api.example.com" npm run desktop:build:staging:mac
> # Windows (CI/Windows)
> STAGING_API_URL="https://staging.api.example.com" npm run desktop:build:staging:win
> ```
> Le script échoue volontairement si `STAGING_API_URL` n'est pas défini (pas
> d'URL en dur, pas de secret). Vérifier l'environnement ciblé **avant** toute
> vente d'essai.

---

## 6. Version portable

Oui, c'est possible et c'est généré automatiquement :
**`POS-Caisse-Portable-<version>.exe`** est un exécutable autonome.

- Copier le `.exe` portable sur une clé USB ou un disque.
- Le brancher sur n'importe quel PC Windows, double-cliquer → l'app démarre.
- Aucune installation, aucun droit administrateur requis.

> Note : « portable » = un seul `.exe` autonome (pas un dossier à copier). C'est
> le format portable standard d'electron-builder, le plus simple et robuste.

---

## 7. Comportement au lancement

- Ouverture directe dans une fenêtre **POS Caisse** (titre propre, icône propre).
- Pas d'onglet navigateur, pas de console, pas de commande.
- Détection automatique d'un 2ᵉ écran → fenêtre **Écran Client** verticale 9:16
  en plein écran dessus, pilotée par un contrôleur dédié (sélection d'écran,
  allumage/écran noir, relance, kiosque, **watchdog anti-crash avec respawn**).
- L'écran client se **configure et se supervise** depuis la caisse : menu profil
  → **« Écran client »** (activation, sélection de l'écran physique, mode, vidéo
  idle, QR, bouton *Identifier l'écran*, diagnostics). Les réglages sont
  **persistés sur le poste** (fichier `customer-display.json` dans le dossier
  `userData`, + `localStorage`), donc conservés au redémarrage.
- Une seule instance : relancer l'app refocalise la fenêtre existante.
- Si le serveur/API est injoignable ou le rendu échoue, un écran clair
  **« Connexion au serveur impossible »** s'affiche avec un bouton *Réessayer*.

---

## 8. Diagnostic des erreurs courantes

| Symptôme | Cause probable | Solution |
|---|---|---|
| Écran « Connexion au serveur impossible » | API injoignable / réseau coupé | Vérifier le réseau et l'URL `VITE_API_URL` du build |
| Fenêtre blanche | Build renderer absent (`dist/`) | Relancer `npm run desktop:build*` (le build régénère `dist/`) |
| Le `.exe` Windows n'est pas généré sur Mac | electron-builder ne crée pas de `.exe` fiable hors Windows | Utiliser la CI GitHub (Option A) ou un PC Windows (Option B) |
| `Cannot compute electron version` | electron hoisté au root du monorepo | Déjà géré : `electronVersion` est épinglé dans `electron-builder.yml` |
| Antivirus Windows bloque le portable | `.exe` non signé | Signer le binaire (certificat code-signing) — voir Limites |

---

## 9. Scripts disponibles

| Script | Rôle |
|---|---|
| `npm run desktop:dev` | Lancer en dev (Vite + Electron, rechargement) |
| `npm run build:main` | Compiler le process principal Electron (TS → JS) |
| `npm run desktop:build` | Build complet pour la plateforme courante |
| `npm run desktop:build:win` | Build Windows (`.exe` installateur + portable) |
| `npm run desktop:build:mac` | Build macOS (`.dmg`) |
| `npm run build` | Build web (inchangé, pour Vercel) — **non cassé** |

---

## 10. Limites actuelles

- **Signature de code** : les `.exe`/`.app` ne sont pas signés. Sur Windows,
  SmartScreen peut avertir ; sur macOS, Gatekeeper aussi. Pour une distribution
  large, ajouter un certificat de signature (Windows EV / Apple Developer ID).
- **Auto-update** : ✅ **configuré** (electron-updater + GitHub Releases). Voir
  §12. La caisse vérifie au démarrage puis ≤ 24 h, télécharge en arrière-plan,
  vérifie l'intégrité (sha512 du `latest.yml`) et installe **hors vente** (à la
  fermeture, ou sur demande quand la caisse est au repos). Reste à ajouter : la
  **signature de code** (ci-dessus) pour supprimer l'avertissement SmartScreen.
- **Périphériques** (imprimante ticket, tiroir, scanner USB, TPE) : l'app charge
  le front existant qui gère déjà certains périphériques côté web ; l'intégration
  desktop native (USB/série) n'est pas encore ajoutée.
- **Le `.exe` Windows n'a pas été produit sur cette machine** (macOS). La chaîne
  complète a été **prouvée en générant le pack macOS** (`POS Caisse.app`) ; le
  build Windows s'exécute à l'identique sur la CI GitHub / un PC Windows.

---

## 11. Recette de validation après installation (Windows 11 x64)

> ⚠️ Cette recette **doit être exécutée sur la machine Windows 11 cible** avec le
> `.exe` produit par la CI (§2, Option A). Elle n'est **pas** exécutable depuis un
> environnement Linux/CI headless : la compatibilité des API a été vérifiée par
> revue de code + rendu des écrans sous Chromium, mais le comportement fenêtres +
> multi-écran Electron se valide sur un vrai poste Windows à deux sorties vidéo.

Compatibilité API (confirmée par audit du code, toutes **supportées sur Windows 11**) :

| Fonction écran client | API | Statut |
|---|---|---|
| Fenêtre client dédiée | `Electron BrowserWindow` | ✅ multiplateforme |
| Détection des écrans | `screen.getAllDisplays()` / `getPrimaryDisplay()` | ✅ |
| Contrôle caisse ↔ écran | IPC `ipcMain.handle` / `ipcRenderer.invoke` / `contextBridge` | ✅ |
| Sync panier temps réel | `BroadcastChannel` | ✅ (Chromium) |
| Stockage vidéo idle | `IndexedDB` | ✅ (Chromium) |
| Plein écran / kiosque | `win.setFullScreen()` / `setKiosk()` | ✅ |
| Anti-crash | `render-process-gone` / `unresponsive` → respawn | ✅ |

> Aucune dépendance runtime ne verrouille Linux/macOS/Android : le process
> principal packagé n'importe que `electron` + `fs`/`path`/`url` (builtins Node).
> Les binaires OS-spécifiques présents en `node_modules` (`@esbuild/*`,
> `@rollup/rollup-*`) sont des **outils de build** et ne sont **jamais** embarqués
> dans l'`.exe` ; sur un hôte Windows npm installe les variantes `win32-x64`.

Checklist à cocher sur le poste (après installation du `Setup.exe`) :

1. [ ] **Lancement app** — double-clic sur le raccourci *POS Caisse* → la fenêtre caisse s'ouvre (pas de navigateur, pas de console).
2. [ ] **Fenêtre caisse** — l'interface POS s'affiche et répond au tactile.
3. [ ] **Fenêtre client** — avec 2 écrans branchés, la fenêtre client verticale 9:16 s'ouvre en plein écran sur le 2ᵉ écran (idle : vidéo/branding + QR).
4. [ ] **Sélection écran client** — menu profil → *Écran client* → *Écran physique* : choisir un écran ; la fenêtre client se déplace sur l'écran choisi.
5. [ ] **Identifier l'écran** — bouton *Identifier* → l'écran client affiche en grand « ÉCRAN CLIENT — TERMINAL 0X » pendant 10 s.
6. [ ] **Panier live** — ajouter des articles en caisse → ils apparaissent en temps réel sur l'écran client ; lancer un paiement → « Présentez votre carte » ; encaisser → « Merci » + QR.
7. [ ] **Écran noir / relance** — boutons *Écran noir* puis *Relancer* → l'écran client s'éteint puis se recharge proprement.
8. [ ] **Persistance des réglages** — modifier l'écran choisi, le mode et le n° de terminal.
9. [ ] **Redémarrage complet** — fermer l'app, la relancer → les réglages (écran, mode, terminal, vidéo) sont conservés ; l'écran client rouvre sur le bon écran.
10. [ ] **Robustesse** — débrancher/rebrancher le 2ᵉ écran → la caisse continue de fonctionner sans interruption ; fermer manuellement la fenêtre client → le watchdog la relance.

En cas d'échec d'un point, joindre : version de l'`.exe`, modèle des 2 écrans + leur résolution, et le contenu de `%APPDATA%\POS Caisse\customer-display.json`.

---

## 12. Mise à jour automatique (electron-updater + GitHub Releases)

La caisse consomme des **releases publiées** (jamais un `git pull` sur les sources).

### Comportement à l'exécution
- **Vérification** : au démarrage (après 30 s) puis **périodiquement, ≤ 24 h**.
- **Téléchargement** en arrière-plan dès qu'une version existe ; **intégrité vérifiée**
  (sha512 du `latest.yml`, par electron-updater).
- **Installation à un moment contrôlé** :
  - automatiquement **à la fermeture** de l'app (`autoInstallOnAppQuit`) → **jamais**
    pendant une vente, un paiement, une impression ou une sync ;
  - ou immédiatement via le bandeau **« Redémarrer et installer »** — refusé côté main
    si une vente / un paiement / une impression / une sync est en cours (garde `updatePolicy`).
- **En cas d'échec** (GitHub/Internet indisponible, download KO) : simple log dans
  `%APPDATA%\POS Caisse\updates.log`, la **version installée continue de tourner**. Une
  caisse ne devient jamais inutilisable.
- **Version installée visible** dans le POS (menu profil → Écran client → ligne *Version*,
  alimentée par `app.getVersion()`).

### Canaux
- **`stable`** (défaut) : consomme les Releases normales (`latest.yml`).
- **`pilot`** : consomme les **pré-releases** GitHub (`beta.yml`). La **1ʳᵉ caisse physique
  = caisse pilote** : la basculer en canal `pilot` (`window.posUpdater.setChannel('pilot')`,
  persisté dans `%APPDATA%\POS Caisse\update-config.json`). Une version testée sur la pilote,
  puis promue en Release stable, atteint ensuite les autres caisses.

### Publier une nouvelle version (procédure)
1. Bumper `packages/pos-desktop/package.json` → `version` (semver, ex. `1.0.1`).
2. Committer, merger sur `main`.
3. Créer et pousser un tag :
   ```bash
   git tag desktop-v1.0.1 && git push origin desktop-v1.0.1
   ```
4. Le workflow **« Build POS Caisse Desktop (.exe) »** package en `--publish always` et crée/
   complète la **Release GitHub** avec `POS-Caisse-Setup-1.0.1.exe`, `latest.yml` et le `.blockmap`.
5. Les caisses en canal `stable` détectent et téléchargent la MAJ à la prochaine vérification.

> **Canal pilote** : marquer la Release GitHub comme **pre-release** → elle alimente `beta.yml`
> (canal `pilot`) sans toucher les caisses `stable`. Promotion : décocher « pre-release ».
>
> **Retirer une version défectueuse** : supprimer/dépublier la Release fautive (ou sa pré-release)
> avant qu'elle n'atteigne le canal stable ; les caisses restent sur la version courante.

### Ce qui reste à activer (hors code, décision/secret)
- **Signature de code Windows** : sans certificat, SmartScreen avertit à la 1ʳᵉ install et
  electron-updater installe une MAJ non signée. Ajouter `win.certificateFile`/`certificatePassword`
  (ou signature EV via CI) dans `electron-builder.yml` — **prévu, activable sans refonte**.
- Le **premier `.exe` installé sur la caisse** doit provenir d'une Release taggée (pour que la
  version installée soit ≥ celle du feed et que la comparaison de versions fonctionne).
