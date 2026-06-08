# POS Caisse — Application Desktop

Application de caisse installable (Windows en priorité, macOS secondaire),
**utilisable sans ligne de commande** par un non-développeur : on double-clique,
le logiciel s'ouvre dans sa propre fenêtre, sans navigateur ni console.

Elle est construite avec **Electron** par-dessus le front-end web existant
(aucune réécriture du POS). Le front est servi en interne via un protocole
`app://`, ce qui fait fonctionner le routage de l'app sous packaging.

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
- Détection d'un 2ᵉ écran → fenêtre **Écran Client** en plein écran dessus.
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
- **Auto-update** : non configuré (pas de serveur de mise à jour). À ajouter via
  `electron-updater` si besoin.
- **Périphériques** (imprimante ticket, tiroir, scanner USB, TPE) : l'app charge
  le front existant qui gère déjà certains périphériques côté web ; l'intégration
  desktop native (USB/série) n'est pas encore ajoutée.
- **Le `.exe` Windows n'a pas été produit sur cette machine** (macOS). La chaîne
  complète a été **prouvée en générant le pack macOS** (`POS Caisse.app`) ; le
  build Windows s'exécute à l'identique sur la CI GitHub / un PC Windows.
