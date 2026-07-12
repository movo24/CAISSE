# POS Caisse — Audit terrain Windows (état factuel Phase 1)

> Date : 2026-07-11 · Base : `main` @ `804104c` · Méthode : lecture directe du code +
> 4 explorations parallèles. **Aucune modification** dans cette phase. Chaque constat
> est prouvé par `fichier:ligne`. Statuts : ✅ opérationnel · 🟢 fonctionnel partiel ·
> 🟠 partiel/fragile · 🔴 cassé/absent · ⚫ absent par conception.

---

## 0. Verdict d'ensemble

| Domaine | État | Résumé |
|---|---|---|
| Installateur Windows (Setup.exe) | ✅ | NSIS + portable, x64, buildable en CI. Non signé. |
| Mise à jour automatique | 🔴 | **Inexistante** — pas d'`electron-updater`, pas de feed, réinstallation manuelle. |
| URL de production | 🟠 | Défaut = Backend A (`api.addxintelligence.com`, DNS en attente) ≠ Backend B déployé. |
| Sans outils dev sur la caisse | ✅ | L'`.exe` est autonome, aucun Node/Git requis. |
| Plein écran / kiosque caisse | 🔴 | Fenêtre 1280×800 décorée, pas de kiosque opérateur. |
| Clavier tactile numérique | 🔴 | `NumericKeypad` défini mais **jamais monté** (code mort). |
| Scanner code-barres (desktop) | 🟠 | Marche via champ focalisé ; service wedge = **code mort** ; pas d'anti-doublon. |
| Imprimante ticket (desktop) | 🟠 | Impression via spooler OS ; **échec non affiché** à la caisse. |
| Tiroir-caisse (desktop) | 🔴 | **Impossible à ouvrir** sur desktop (BLE uniquement, câblé iPad seulement). |
| Écran client (2ᵉ écran) | ✅ | Robuste : récupération par signature, kiosque secondaire, watchdog, jamais bloquant. |
| Réseau / offline / idempotence | ✅ | syncEngine solide, clés d'idempotence, timeout 15 s, pastille statut. |
| Sécurité / secrets | ✅ | Aucun secret en dur ; Stripe via token backend ; fenêtre sandbox. |
| Tactile opérateur (matériel) | ⚠️ | Défaut HID/pilote/câble Windows — **hors logiciel** ; procédure terrain fournie (§7). |

**Cause racine transverse.** Toute la pile périphérique riche (tiroir ESC/POS, sélection
imprimante, test d'impression, feedback d'échec, scanner caméra) est câblée **uniquement
dans `IPadPOSLayout.tsx`**. La cible réelle est un **mini-PC Windows** qui rend
`POSPage.tsx` (layout desktop), lequel **n'a ni tiroir, ni écran de réglage imprimante,
ni retour d'échec d'impression**. C'est le principal chantier.

---

## 1. Installateur Windows — ✅ existe, non signé

- `electron-builder.yml` : cibles **`nsis`** (`POS-Caisse-Setup-${version}.exe`, l.40) +
  **`portable`** (`POS-Caisse-Portable-${version}.exe`, l.43), **x64** (l.29-31),
  `appId: com.addxintelligence.poscaisse`, `productName: POS Caisse`, `oneClick:false`,
  raccourcis bureau+menu (l.37-38), choix du dossier (l.36).
- `.github/workflows/desktop-build.yml` : build sur **runner Windows** (l.32), gate qualité
  (lint+tests+typecheck, l.46-58), garde « pas de test dans dist/main » (l.85-91),
  `--publish never` (l.100), upload artefact `POS-Caisse-Windows` (l.112-118), **Release
  GitHub sur tag `desktop-v*`** (l.121-125). → **vrai Setup.exe produisible sans PC Windows.**
- Fonctionne sans outils dev : `src/main/index.ts` sert le renderer via `app://`,
  single-instance lock (l.139), écran d'erreur intégré « Connexion au serveur impossible »
  (l.108-132). Sécurité fenêtre : `nodeIntegration:false, contextIsolation:true, sandbox:true`
  (l.74-77).
- **Manques** : (a) **pas de signature de code** (aucun `certificateFile`/`sign`) →
  SmartScreen avertit (`DESKTOP_APP_README.md:197`). (b) icône = `build/icon.png` (pas de
  `.ico` dédié). (c) `version: 0.1.0` (`package.json:3`) — à passer en **semver** réel.

## 2. Mise à jour automatique — 🔴 inexistante (écart n°1)

- **`electron-updater` absent** des dépendances (`package.json:30-63`) ; **aucun `autoUpdater`**
  dans `src/main/` ; `electron-builder.yml` **sans bloc `publish:`** → aucun `latest.yml`/manifeste.
- Le workflow package en **`--publish never`** (`desktop-build.yml:100`) ; commentaire l.94 :
  « this app has no auto-update/publish target ». Les Releases GitHub existent (sur tag) mais
  **rien ne les consomme**.
- La version est affichée dans l'UI (`CustomerDisplaySettingsPage.tsx:456`) mais lit
  `POS_APP_VERSION || 'dev'` (`preload.ts:18`), et `POS_APP_VERSION` **n'est jamais posé au
  build** → l'UI montre `'dev'`.
- **Conséquence** : mettre à jour une caisse = retélécharger et réinstaller l'`.exe` à la main.
  Aucun canal, aucun rollout progressif, aucune vérif d'intégrité, aucun rollback.

## 3. URL de production — 🟠 à trancher

- `src/renderer/utils/apiConfig.ts:23` : défaut packagé = **`https://api.addxintelligence.com`**
  (= **Backend A**, « canonical prod, DO NOT TOUCH », **cutover DNS en attente**).
- Or le code récent (attract, packs, avoirs…) est déployé sur **Backend B**
  `caisse-backend-production.up.railway.app`. Le `.exe` par défaut parle donc à Backend A.
- 2ᵉ URL en dur hors `apiConfig` : `IPadPOSLayout.tsx:912`
  (`https://api.addxintelligence.com/api/receipts/…`) → ne suit pas `VITE_API_URL`.
- **Décision requise** (archi/prod) : builder avec `VITE_API_URL=<Backend B>`, ou finaliser
  le DNS de `api.addxintelligence.com` vers le backend courant.

## 4. Écran / ergonomie tactile — 🔴 kiosque absent, clavier tactile mort

- **Kiosque/plein écran opérateur : absent.** `src/main/index.ts:64-79` crée une fenêtre
  `1280×800` décorée, redimensionnable ; aucun `fullscreen`/`kiosk`/`autoHideMenuBar`.
- **Clavier numérique tactile : code mort.** `components/ipad/NumericKeypad.tsx:13` défini mais
  **jamais monté** (confirmé par `posStore.invariants.test.ts:50`). Les saisies (comptage,
  split, poids, email) utilisent des `<input>` standards → **clavier physique/OS requis**.
- **Hover-only : globalement sûr** — `hover:` appariés à `active:`, `.product-card-touch
  { touch-action: manipulation }` (`globals.css:302-307`) ; lignes de résultat `onMouseEnter`
  **mais aussi** `onClick` (`POSPage.tsx:1237-1238`). Aucune action hover-only fonctionnelle.

## 5. Scanner code-barres (desktop) — 🟠 marche mais fragile

- **Service wedge = code mort** : `peripheralBridge.ts:462-501` (`startBarcodeListener` →
  `startKeyboardWedgeListener`, keydown global, buffer 80 ms, Enter≥4) **n'est appelé nulle
  part** (grep : définition seule).
- **Vrai chemin desktop** : champ de recherche focalisé `<input class="scan-input">`
  (`POSPage.tsx:1211-1220`) → `Enter` → `handleScan` (l.538-569) : match EAN local, sinon
  `productsApi.scan`, sinon produit inconnu. Une douchette qui « tape » dans ce champ focalisé
  marche.
- **Fragilités** : refocus agressif mais **dépendant du focus** (si le focus part sur un bouton,
  le scan va ailleurs) ; **aucun anti-doublon** sur ce chemin (deux Enter rapides = 2 lignes ;
  le cooldown 2 s n'existe que dans `ScannerTool.tsx:155`, iPad) ; certains modaux ne refocalisent
  pas `scanRef`.

## 6. Imprimante ticket (desktop) — 🟠 spooler OS, échec non affiché

- **Impression = spooler OS** (`webContents.print`) : renderer construit un ticket HTML 80 mm
  (`peripheralBridge.ts:214`), envoyé via IPC `printTicketHtml` (`preload.ts:29`), imprimé
  silencieusement dans une fenêtre cachée (`posPrinting.ts:25-46`). Pas d'ESC/POS sur desktop.
- **Honnêteté partielle** : le spooler renvoie un vrai succès/échec (`posPrinting.ts:37`,
  timeout 20 s l.34) ; le bridge ne renvoie `true` que si `result.ok` (`peripheralBridge.ts:198`) ;
  `usePayment.ts:345-347` pose `lastPrintStatus`. **MAIS l'overlay desktop
  (`POSPage.tsx:1965-1971`) n'utilise pas `lastPrintStatus`** → un échec d'impression sur
  imprimante desktop connectée **n'est pas signalé au caissier**. Seul l'iPad affiche les 3 états.
- **Impression par défaut** : `printThermalUSB` (`peripheralBridge.ts:197`) appelle
  `printTicketHtml(html)` **sans nom d'imprimante** → toujours l'imprimante **par défaut** OS.
- **Sélection/persistance/test/statut imprimante** : **absents sur desktop** (existent dans
  `PrinterSettings.tsx`, monté **iPad uniquement**). Desktop auto-choisit `electronPrinters[0]`.
- **Réimpression** : traçabilité loggée (`posStore.ts:476-484`, `reprintCount`+`reprintLog`,
  gated `canReprintTicket`) et aperçu **DUPLICATA** filigrané, mais le bouton « Imprimer » du
  duplicata **ne fait qu'un `console.log`** (`TicketHistoryModal.tsx:420-424`) → **aucun papier**.
- **Manque de papier** : non détecté (le spooler accepte le job ; aucune requête statut ESC/POS).
- **Encodage** : chemin HTML/spooler = UTF-8 → accents/€ OK. (Chemin ESC/POS BLE : pas de code-page,
  accents risqués, « EUR » au lieu de €, coupe `GS V 0` — mais **non utilisé sur desktop**.)

## 7. Tiroir-caisse (desktop) — 🔴 impossible à ouvrir

- Le kick ESC/POS existe (`useBluetoothPrinter.ts:216-220`, `ESC p 0`) mais **uniquement via BLE**,
  câblé **seulement** dans `IPadPOSLayout.tsx:101`.
- `detectCashDrawer` (`peripheralBridge.ts:555-566`) ne pose jamais que `bluetooth` ou `none` ;
  sur desktop → `none` → `openCashDrawer` refuse honnêtement (`:588`). **Aucun kick tiroir via le
  spooler/USB desktop.** `usePayment.ts:356-362` tente l'ouverture après vente espèces mais elle
  échoue faute de tiroir câblé sur desktop.
- **Impact terrain** : le tiroir est branché sur l'imprimante USB — l'app desktop **ne peut pas
  l'ouvrir** aujourd'hui.

## 8. Écran client (2ᵉ écran) — ✅ robuste

- Détection & sélection : `displaySelection.ts:70-107` — priorité (1) `screenId` persisté,
  (2) **signature** `resolution+bounds+rotation` pour retrouver le même écran après renumérotation
  Windows, (3) meilleur non-primaire, (4) primaire si mono-écran.
- Kiosque **secondaire uniquement** : `customerDisplay.ts:237-238` (`fullscreen/kiosk && onSecondary`),
  jamais sur l'écran opérateur (l.304-316).
- Débranchement : watchdog respawn (`render-process-gone`/`unresponsive`/`closed`, l.253-282) ;
  hot-plug géré (`display-added/removed/metrics-changed`, l.438-463) « Never throws, never blocks the POS ».
- **La caisse continue si l'écran client est absent** (l.215-221 « runs headless-of-client »).
- 9:16 : la fenêtre remplit l'écran cible (fallback 1080×1920) ; le renderer letterbox en 9:16
  (`ClientDisplayPage.tsx:398`). Pas d'auto-rotation d'un panneau physiquement paysage.

## 9. Réseau / offline / idempotence — ✅ solide

- Détection : `navigator.onLine` + HEAD `/api/health` (timeout 3 s) (`syncEngine.ts:31-48`) ;
  listeners `online/offline` + poll 15 s (l.366-411) ; resync 2 s après reconnexion.
- File offline persistée (`useOfflineMode`) ; sync FIFO+priorité (l.13-24, 295-300) ; re-check
  réseau toutes les 5 entrées.
- **Idempotence** : `idemKey = payload.idempotencyKey || idempotencyKeyFor(type,id)` (l.135),
  envoyée au backend ; `markAsSent` **avant** l'appel réseau (l.141) + rollback (l.239). 4xx =
  rejet permanent (l.244-250), sinon retry.
- Pastille statut réseau UI (`POSPage.tsx:1084-1097`). Axios timeout 15 s (`api.ts:7`).
- **Manques** : état `'degraded'` défini mais **jamais posé** (pas internet ≠ backend down non
  distingués) ; HMAC sync calculé mais **non câblé** (repose sur le JWT) ; `tryRefreshToken`
  (`api.ts:50`) sans timeout.

## 10. Sécurité / secrets — ✅ propre

- **Aucun secret en dur** (grep `sk_live/sk_test/pk_*/ghp_/whsec/RAILWAY/password` → seulement
  des types/`Bearer ${token}` runtime lus depuis `localStorage`). Stripe via **token de
  connexion backend** (`useStripeTerminal.ts:135-157`), aucun `pk_*` embarqué.
- `.env.example` : `VITE_API_URL` (documenté) + `POS_APP_VERSION` (optionnel). Aucun secret.
- Modes mock/demo : lecteurs Stripe simulés **gated `!import.meta.env.PROD`** ; carte « demo »
  **fail-closed en prod** (`cardPaymentMode.ts:23` → `'disabled'`), jamais de vente « payée » fictive.

## 11. Tactile opérateur qui ne répond pas — ⚠️ matériel/pilote (hors logiciel)

Le logiciel ne peut pas réparer un défaut HID/pilote/câble. L'app **est compatible** d'un écran
tactile Windows HID standard (c'est une fenêtre Chromium ; les événements tactiles fonctionnent si
Windows les délivre). Procédure terrain → voir §Diagnostic tactile ci-dessous.

---

## Procédure terrain — diagnostic tactile Windows

1. Le **VGA ne transporte pas le tactile** — ne pas s'en servir pour diagnostiquer.
2. Vérifier que le **câble USB** relie bien l'écran (prise USB **tactile/« touch »** de l'écran,
   pas une prise hub) au mini-PC.
3. Tester un **autre câble USB** (data, pas charge seule) et un **autre port USB** du mini-PC
   (idéalement USB direct carte-mère, pas hub passif).
4. **Gestionnaire de périphériques** (`devmgmt.msc`) → « Périphériques d'interface utilisateur (HID) »
   → chercher **« Écran tactile compatible HID »**. Absent → problème câble/prise/pilote.
5. S'il est **désactivé** → clic droit → Activer. En **erreur (jaune)** → Mettre à jour / réinstaller
   le pilote, sinon **pilote constructeur** de l'écran.
6. Chercher les **périphériques inconnus / en erreur** (jaune) → installer le pilote adéquat.
7. **Paramètres → Tablet PC** / « Calibrer l'écran pour la saisie au stylet ou tactile »
   (`Panneau de configuration → Paramètres du Tablet PC`) → **Configurer** → assigner le tactile au
   **bon écran** (crucial en double écran) → **Étalonner**.
8. **Tester le tactile HORS du POS** (toucher le menu Démarrer, une fenêtre Windows). S'il ne marche
   pas hors POS → c'est 100 % matériel/pilote, l'app n'y peut rien.
9. Une fois le tactile OK sous Windows → confirmer dans le POS.

> Note logiciel : la fenêtre POS doit idéalement passer en **kiosque plein écran** sur l'écran
> opérateur (voir §4 — actuellement absent) pour un usage tactile propre.

---

## Procédure terrain — test imprimante (état actuel)

1. Windows doit voir l'imprimante (Panneau → Imprimantes) et **la définir par défaut** (l'app
   desktop imprime aujourd'hui sur l'imprimante **par défaut**).
2. Imprimer une **page de test Windows** depuis le pilote → valide câble/pilote/papier.
3. Dans le POS : faire une vente réelle (build staging) → le ticket part au spooler.
4. ⚠️ Aujourd'hui, si l'impression échoue, **le POS desktop ne l'affiche pas** (§6) — corriger.
5. Tiroir : **ne s'ouvre pas** sur desktop aujourd'hui (§7) — corriger.

---

## Écarts priorisés (proposition de remédiation — Phase 2)

| # | Écart | Prio | Nature |
|---|---|---|---|
| W1 | Mise à jour auto (`electron-updater` + feed + canaux pilot/stable + intégrité + rollback + version UI) | **P0** | Archi (à cadrer : hébergement du feed) |
| W2 | Tiroir-caisse desktop (kick via ESC/POS RAW vers l'imprimante, ou passage périph. desktop) | **P0** | Code |
| W3 | Feedback d'échec d'impression sur l'overlay desktop (`lastPrintStatus`) | **P0** | Code |
| W4 | Sélection + persistance imprimante + **écran diagnostic** (test impression, test tiroir, statut, dernière erreur, nom imprimante) sur desktop | **P0** | Code |
| W5 | URL de prod : cibler le backend courant (VITE_API_URL) ou finaliser DNS | **P0** | Décision |
| W6 | Kiosque plein écran opérateur + montage du clavier numérique tactile | **P1** | Code |
| W7 | Activation du service scanner wedge (focus-indépendant) + anti-doublon | **P1** | Code |
| W8 | Version semver + stamping `POS_APP_VERSION` au build + affichage dans le POS | **P1** | Code |
| W9 | Réimpression duplicata qui imprime réellement (avec traçabilité déjà en place) | **P1** | Code |
| W10 | Signature de code Windows (préparer la config, activable sans refonte) | **P2** | Décision (certificat) |
| W11 | 2ᵉ URL en dur `IPadPOSLayout.tsx:912` → passer par `apiConfig` | **P2** | Code |
| W12 | Distinguer « pas d'internet » vs « backend down » (état `degraded`) | **P2** | Code |

> Les items **P0/P1 de nature « Code »** sont réversibles, testables, en branche : exécutables
> sans GO supplémentaire. Les items **Décision/Archi** (W1 hébergement du feed, W5 URL/DNS,
> W10 certificat) nécessitent un arbitrage owner.
