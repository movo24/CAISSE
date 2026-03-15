# Plan d'implémentation — Architecture "Casino & Flux"

## Vue d'ensemble
3 piliers : Occupancy/Météo, Loterie Smart-Foule, Expérience Jackpot.
~25 fichiers à créer/modifier.

---

## PILIER 1 — Système de Flux et Environnement

### Backend (4 fichiers)

**1.1 Entity `jackpot-config.entity.ts`** — Paramètres admin verrouillés par le siège
- `storeId`, `megaJackpotQuotaPerDay` (default 1), `smallWinQuotaPerDay` (default 3)
- `densityThresholdForMega` (seuil live_count pour activer le mega)
- `megaProbabilityPercent`, `smallWinProbabilityPercent`
- `rouletteVideoUrl`, `winVideoUrl`, `thanksVideoUrl`
- `winAudioUrl`, `thanksAudioUrl`
- `openWeatherApiKey`, `openWeatherCity`
- `isActive` boolean
- Seul le rôle `admin` (siège) peut modifier ces valeurs.

**1.2 Module `OccupancyModule`** (3 fichiers: module, service, controller)
- **Service**: In-memory Map<storeId, { liveCount, lastUpdate }>. Pas de DB — c'est du temps réel.
- **Controller**:
  - `POST /api/occupancy/update` — reçoit `{ storeId, liveCount }` depuis le logiciel radar. Authentifié par API key (header `X-Radar-Key`). `@SkipTenantCheck()`.
  - `GET /api/occupancy/:storeId` — retourne le live_count actuel. Authentifié JWT.
  - `GET /api/occupancy/:storeId/weather` — proxy vers OpenWeatherMap, retourne `{ icon, temp, description }`. Cache 10 min en mémoire.

**1.3 Module `JackpotModule`** (4 fichiers: entity enregistrée, module, service, controller)
- **Service** (`jackpot.service.ts`):
  - `getConfig(storeId)` — retourne la config active
  - `updateConfig(storeId, data)` — admin only, met à jour les quotas/médias
  - `getUsageToday(storeId)` — combien de mega/small déjà gagnés aujourd'hui
  - `rollLottery(storeId, saleId)` — L'ALGORITHME PRINCIPAL (voir Pilier 2)
  - `recordWin(storeId, saleId, type)` — log le gain
- **Controller**: CRUD config (admin only) + `GET /api/jackpot/:storeId/status` (quotas restants)

**1.4 Entity `jackpot-win.entity.ts`** — Historique des gains
- `id`, `storeId`, `saleId`, `type` (mega_jackpot | small_win | no_win), `timestamp`

### Frontend POS — Widget vendeur (1 fichier modifié)

**1.5 Modifier `POSPage.tsx`** — Ajouter dans le header un widget discret :
- Icône personnes + `live_count` (polling /occupancy/:storeId toutes les 10s)
- Icône météo + température (polling /occupancy/:storeId/weather toutes les 10 min)
- Petit badge, non intrusif, côté gauche du header

---

## PILIER 2 — Algorithme de Loterie "Smart-Foule"

### Backend — dans `jackpot.service.ts`

**Méthode `rollLottery(storeId, saleId)`** :

```
1. Charger config du store (quotas, seuils, probabilités)
2. Charger usage du jour (combien de mega/small déjà distribués)
3. Charger live_count depuis OccupancyService

MEGA JACKPOT:
- Si live_count < densityThreshold → probabilité = 0% (BLOQUÉ)
- Si quotaMegaJackpot atteint aujourd'hui → probabilité = 0%
- Sinon → random < megaProbabilityPercent% → MEGA WIN

SMALL WIN:
- Si quotaSmallWin atteint → 0%
- Sinon → random < smallWinProbabilityPercent% → SMALL WIN

DEFAULT: NO_WIN (vidéo de remerciement standard)

4. Si gain → persister dans jackpot_wins + décrémenter quota
5. Retourner { type, config } pour le frontend
```

**Intégration dans `SalesService.createSale()`** :
- APRÈS le `commitTransaction()` (le gain ne bloque JAMAIS la vente)
- Appel fire-and-forget au JackpotService
- Le résultat est retourné dans la réponse de la vente : `sale.jackpotResult`

---

## PILIER 3 — Expérience Client "Jackpot" (Écran Secondaire)

### Frontend POS — ClientDisplayPage.tsx (réécriture majeure)

**3.1 Mode Standard** (existant, amélioré) :
- Panier en cours, prix, total — INCHANGÉ
- Ajout d'un footer subtil avec le branding

**3.2 Mode Célébration** (NOUVEAU) — overlay plein écran :
- Déclenché quand `store.lastTicket?.jackpotResult` change
- **Séquence** :
  1. Fade-out du panier (300ms)
  2. **Vidéo roulette** plein écran (3 sec, pré-chargée)
  3. Si MEGA/SMALL → **Vidéo victoire** (explosion confettis, 777) + Audio trompettes
  4. Si NO_WIN → **Vidéo remerciement** + Audio standard
  5. Auto-dismiss après fin vidéo → retour mode standard

**3.3 Pré-chargement des médias** :
- Au montage du composant, `<video preload="auto">` pour les 3 vidéos
- `<audio preload="auto">` pour les 2 sons
- Les URLs viennent de `jackpotConfig` chargé au login
- Éléments HTML cachés (`display:none`) qui se révèlent au moment voulu

**3.4 Gestion des erreurs médias** :
- Si vidéo pas chargée / erreur réseau → skip l'animation, afficher texte fallback
- Ne JAMAIS bloquer la vente ou l'impression du ticket
- `onerror` handlers sur chaque `<video>` et `<audio>`

### Frontend POS — Zustand Store (posStore.ts modifié)

**3.5 Nouveaux champs dans le store** :
- `jackpotResult: { type, config } | null`
- `occupancy: { liveCount, lastUpdate } | null`
- `weather: { icon, temp, description } | null`
- `jackpotConfig: JackpotConfig | null`
- Actions : `setJackpotResult()`, `setOccupancy()`, `setWeather()`, `setJackpotConfig()`

### Frontend POS — API service (api.ts étendu)

**3.6 Nouveaux endpoints** :
- `occupancyApi.get(storeId)` — GET /occupancy/:storeId
- `occupancyApi.weather(storeId)` — GET /occupancy/:storeId/weather
- `jackpotApi.getConfig(storeId)` — GET /jackpot/:storeId/config
- `jackpotApi.getStatus(storeId)` — GET /jackpot/:storeId/status

### Backend — Gestion des Assets (SettingsPage back-office)

**3.7 Section "Gestion des Assets"** dans SettingsPage.tsx (back-office) :
- Formulaire avec les champs :
  - URL vidéo roulette (.mp4)
  - URL vidéo victoire (.mp4)
  - URL vidéo remerciement (.mp4)
  - URL audio victoire
  - URL audio standard
- Sauvegarde via `PUT /api/jackpot/:storeId/config`

---

## Fichiers à créer (12 nouveaux)

| # | Fichier | Rôle |
|---|---------|------|
| 1 | `backend/src/database/entities/jackpot-config.entity.ts` | Config loterie par store |
| 2 | `backend/src/database/entities/jackpot-win.entity.ts` | Historique des gains |
| 3 | `backend/src/modules/occupancy/occupancy.module.ts` | Module occupancy |
| 4 | `backend/src/modules/occupancy/occupancy.service.ts` | Service flux temps réel |
| 5 | `backend/src/modules/occupancy/occupancy.controller.ts` | API radar + météo |
| 6 | `backend/src/modules/jackpot/jackpot.module.ts` | Module loterie |
| 7 | `backend/src/modules/jackpot/jackpot.service.ts` | Algorithme Smart-Foule |
| 8 | `backend/src/modules/jackpot/jackpot.controller.ts` | API config + status |
| 9 | `pos-desktop/src/renderer/components/FluxWidget.tsx` | Widget vendeur (météo+flux) |
| 10 | `pos-desktop/src/renderer/components/JackpotOverlay.tsx` | Overlay casino écran client |
| 11 | `backend/test/jackpot-lottery.spec.ts` | Tests algorithme loterie |
| 12 | `backend/test/occupancy.spec.ts` | Tests occupancy |

## Fichiers à modifier (8)

| # | Fichier | Modification |
|---|---------|-------------|
| 1 | `backend/src/app.module.ts` | + OccupancyModule, JackpotModule |
| 2 | `backend/src/database/entities/index.ts` | + exports nouvelles entities |
| 3 | `backend/src/modules/sales/sales.service.ts` | + appel jackpot post-transaction |
| 4 | `pos-desktop/src/renderer/stores/posStore.ts` | + state jackpot/occupancy/weather |
| 5 | `pos-desktop/src/renderer/services/api.ts` | + endpoints occupancy/jackpot |
| 6 | `pos-desktop/src/renderer/pages/POSPage.tsx` | + FluxWidget dans header |
| 7 | `pos-desktop/src/renderer/pages/ClientDisplayPage.tsx` | + JackpotOverlay + preload |
| 8 | `backoffice-web/src/pages/SettingsPage.tsx` | + onglet Gestion Assets |

## Contraintes respectées
- ✅ Le gain ne bloque JAMAIS la vente (fire-and-forget post-commit)
- ✅ Les quotas viennent de la DB admin, pas modifiables en local
- ✅ Pré-chargement des vidéos/audio pour 0 lag
- ✅ Fallback texte si média indisponible
- ✅ Tenant-scoped (storeId sur tout)
- ✅ Rate limiting hérité du ThrottlerModule global
