# Migration per-machine → per-user (v1.0.6 → v1.0.7)

> **Nature du changement.** Ce n'est PAS une mise à jour normale, mais une
> **migration d'installation**. La v1.0.6 déployée est en per-machine
> (`C:\Program Files\@caissepos-desktop`, entrée registre HKLM). La v1.0.7 est en
> per-user (`%LOCALAPPDATA%\Programs\@caissepos-desktop`). Les deux emplacements
> peuvent coexister → risque de doublons de raccourcis et de relance de l'ancienne
> copie. La migration doit donc être faite **une fois par poste, par un
> administrateur**, avec le script fourni.

## Pourquoi

L'installeur v1.0.6 était **assisté** (`oneClick: false`). Sur la caisse, le
choix « Pour tous les utilisateurs » a été retenu à l'installation initiale →
écriture dans `Program Files` → élévation → **UAC**, et binaire **non signé** →
« Éditeur inconnu ». En production, l'employé ne doit voir aucun assistant,
aucun choix, aucun bouton, aucune invite UAC.

## Ce que corrige la v1.0.7 (config)

`packages/pos-desktop/electron-builder.yml` :

```yaml
nsis:
  oneClick: true                        # aucun assistant, aucun bouton
  perMachine: false                     # profil utilisateur → aucune élévation
  allowElevation: false                 # jamais d'UAC pour l'employé
  allowToChangeInstallationDirectory: false
  runAfterFinish: true                  # relance auto du POS après MAJ
  deleteAppDataOnUninstall: false       # données terminal jamais effacées
```

`packages/pos-desktop/src/main/updater.ts` :

```diff
- autoUpdater.quitAndInstall(false, true)   // isSilent=false → assistant visible
+ autoUpdater.quitAndInstall(true, true)    // isSilent=true → install silencieuse + relance
```

`autoDownload = true` et `autoInstallOnAppQuit = true` sont **inchangés** (déjà
corrects : téléchargement silencieux prouvé en 1.0.6, install à la fermeture
jamais en pleine vente).

## Objectif réaliste

> **Une dernière intervention administrateur contrôlée** pour migrer chaque
> caisse. **À partir de la v1.0.7 per-user, toutes les MAJ suivantes sont
> automatiques et sans aucun clic.**

## Procédure (une fois par poste)

1. **Sauvegarde** de `%APPDATA%\@caisse` (sessions, `machine-id.txt`, journaux
   périphériques). — *fait automatiquement par le script, en COPIE.*
2. **Inventaire** du chemin actuel, des entrées registre et des raccourcis. —
   *fait par le script (mode audit).*
3. **Désinstallation contrôlée** de la copie `Program Files` (silencieuse `/S`,
   admin).
4. **Installation unique** de la v1.0.7 per-user (silencieuse `/S`, sans
   élévation).
5. **Vérification** qu'aucune seconde copie ne subsiste (HKLM vide, 1 seul
   binaire).
6. **Restauration/validation** des données (le script ne touche jamais
   `%APPDATA%\@caisse`).
7. **Preuve** que les raccourcis pointent vers
   `%LOCALAPPDATA%\Programs\@caissepos-desktop`.

### Script

`packages/pos-desktop/scripts/migrate-per-user-v1.0.7.ps1`

```powershell
# 1) Audit seul (ne modifie RIEN) :
powershell -ExecutionPolicy Bypass -File .\migrate-per-user-v1.0.7.ps1

# 2) Migration réelle (session admin) :
powershell -ExecutionPolicy Bypass -File .\migrate-per-user-v1.0.7.ps1 `
    -Execute -Installer "D:\releases\The-Wesleys-POS-Setup-x64.exe"
```

Le script : dry-run par défaut ; sauvegarde avant toute désinstallation ;
s'arrête sur toute ambiguïté (0 ou >1 install, installeur/désinstalleur
introuvable, non-admin) ; **ne supprime jamais** `%APPDATA%\@caisse` ; journal
horodaté ; vérifie version + chemin final + copie unique.

### Rollback

Les données ne sont jamais modifiées et la sauvegarde est conservée. En cas
d'échec : réinstaller la v1.0.6 (ou restaurer la sauvegarde), la caisse
retrouve son état.

## Plan de test — poste témoin (canal pilot)

À exécuter sur **un seul poste témoin**, jamais directement en prod.

1. Build v1.0.7 avec la nouvelle config NSIS ; publier en **pré-release** et la
   servir sur le **canal `pilot`** (`beta.yml`).
2. Sur le témoin en 1.0.6 per-machine : lancer le script en **audit** →
   vérifier l'inventaire (1 entrée HKLM, chemin `Program Files`, raccourcis).
3. Lancer le script avec `-Execute -Installer <exe v1.0.7>`.
4. **Critères de succès (zéro clic employé)** :
   - aucun assistant, aucune page « tous / juste pour moi » ;
   - **aucune invite UAC** ;
   - le POS se ferme et **redémarre seul** en 1.0.7 ;
   - `%APPDATA%\@caisse\pos-desktop` intact (sessions/paramètres conservés) ;
   - `updates.log` complet.
5. Vérifier : binaire dans `%LOCALAPPDATA%\Programs\@caissepos-desktop`,
   version = 1.0.7, **aucune** entrée HKLM, une seule copie, raccourcis à jour.
6. **Boucle MAJ silencieuse** : publier une v1.0.8 de test en pilot →
   confirmer `update-available → update-downloaded → install → relance`
   **sans aucune interaction ni UAC**.
7. Si tout est vert : promouvoir en stable et planifier la migration des autres
   caisses (script, une fois chacune).

## Feuille de route — signature Authenticode

La signature **ne supprime pas** l'UAC d'une install per-machine (l'objectif
zéro-clic est atteint ici par le per-user, sans élévation). Elle reste
**recommandée** pour que Windows cesse durablement de présenter le logiciel comme
provenant d'un « éditeur inconnu » (SmartScreen, première install manuelle,
confiance). À intégrer au pipeline de build (`win.certificateSubjectName` /
`CSC_LINK` en CI) dès qu'un certificat OV/EV est disponible.
```
