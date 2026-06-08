# Offline-first Inventaire — socle

Premier socle offline pour l'app mobile Inventaire, inspiré du pattern POS
desktop (`packages/pos-desktop/src/renderer/stores/offlineStore.ts` +
`services/syncEngine.ts`), réduit au strict nécessaire et **non décoratif**.

## Ce qui est livré (testé)

| Brique | Fichier | État |
|---|---|---|
| Stockage local (IndexedDB via `idb`) | `db.ts` | ✅ |
| File de comptage + enveloppe d'audit | `queue.ts` | ✅ (5 tests vitest) |
| `deviceId` stable persistant | `deviceId.ts` | ✅ |
| Détection online/offline (events + ping `/api/health`) | `network.ts` | ✅ |
| Sync différée FIFO vers `POST /api/inventory-scans` | `syncEngine.ts` | ✅ |
| Store offline (statut, compteur, enqueue, syncNow) | `../stores/offlineStore.ts` | ✅ |
| Indicateur UI online/offline + « N en attente » | `../components/OfflineIndicator.tsx` | ✅ (câblé dans `AppShell`) |

**Audit trail** : chaque entrée conserve `employeeId`, `storeId`, `deviceId`,
`createdAt` (ISO), `timezone`. Persistance survit à la fermeture de l'app
(IndexedDB). Sync rejouée automatiquement au retour réseau.

## Critères d'acceptation couverts
- ✅ détection online/offline
- ✅ file locale de comptage
- ✅ persistance après fermeture app (IndexedDB)
- ✅ sync différée (déclenchée au retour réseau / `syncNow`)
- ✅ statut de sync visible (barre `OfflineIndicator`)
- ✅ conservation employeeId/storeId/deviceId/timestamp
- ✅ gestion basique des erreurs de sync (retry + plafond `maxRetries`)

## Reste à faire (volontairement hors de cette passe — non cassant)

1. **Rerouter le comptage réel** : `InventoryPage.tsx` / `ScanPage.tsx` appellent
   aujourd'hui l'API en direct (online). Les faire passer par
   `useOfflineStore().enqueue(...)` pour devenir offline-first. *(Touche la
   logique des écrans existants → passe dédiée + QA.)*
2. **Idempotence serveur** : `clientEntryId` est déjà envoyé ; ajouter une
   dé-duplication côté `inventory-scan` (clé = `clientEntryId`) pour couvrir le
   cas « réponse 2xx perdue après commit serveur ».
3. **Résolution de conflits** : aujourd'hui le serveur fait foi (append d'un
   scan). Définir la règle si comptages concurrents sur le même produit.
4. **Reprise/visibilité détaillée** : écran listant les entrées en attente /
   échouées avec action de relance manuelle par entrée.
5. **Login offline** : permettre l'usage sur token déjà obtenu sans réseau.

## Lancer les tests
```bash
cd packages/mobile
npm test            # vitest (file de comptage, fake-indexeddb)
```
