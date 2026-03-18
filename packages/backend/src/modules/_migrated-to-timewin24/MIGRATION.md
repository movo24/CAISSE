# Modules migrés vers TimeWin24

Ces modules ont été retirés du POS/CAISSE et doivent être réintégrés dans TimeWin24.
Le POS reste un système transactionnel pur. TimeWin24 = cerveau (analyse, IA, décisions).

## Architecture cible

```
POS (CAISSE)                    TimeWin24
─────────────                   ──────────
scan, panier, paiement    →     POST /events/sales
session employé           →     POST /events/session
mouvements stock          →     POST /events/inventory
                          ←     GET  /employees (auth, permissions)
                          ←     GET  /stores (autorisés)
```

## Modules à réintégrer

### 1. pos-ai (Gemini AI)
- **Rôle** : Recherche sémantique produits, NLP français, anomalies catalogue, contexte magasin
- **Dépendances** : `@google/generative-ai`, ProductEntity, StoreEntity
- **Endpoints** : `/pos-ai/search`, `/pos-ai/natural-query`, `/pos-ai/assistant`, `/pos-ai/anomalies`
- **Action TimeWin24** : Créer un module AI avec accès aux données produits synchronisées depuis le POS

### 2. ia (Claude AI)
- **Rôle** : Chat conversationnel, rapports IA, suggestions prix, prévisions revenus
- **Dépendances** : `@anthropic-ai/sdk`, SaleEntity, ProductEntity, ZReportEntity
- **Endpoints** : `/ia/chat`, `/ia/report`, `/ia/pricing/:productId`, `/ia/forecast`
- **Action TimeWin24** : Intégrer Claude comme assistant analytics dans le dashboard TimeWin24

### 3. decision-engine (Moteur de règles)
- **Rôle** : Évaluation automatique toutes les 15 min (météo, transport, trafic, performance)
- **Dépendances** : Weather, Transport, Footfall, PosAi, Sales, Products, Employees
- **Endpoints** : `/decision-engine/rules`, `/decision-engine/:storeId/evaluate`, `/decision-engine/:storeId/alerts`
- **Action TimeWin24** : Migrer le moteur de règles, le connecter aux données POS via API events

### 4. live-performance (Analytics réseau)
- **Rôle** : Comparaison multi-magasins temps réel, ranking, insights IA
- **Dépendances** : IaModule (Claude), StoreEntity, SaleEntity
- **Endpoints** : `/live-performance/network`, `/live-performance/compact`, `/live-performance/insight`
- **Action TimeWin24** : Dashboard analytics natif dans TimeWin24

### 5. weather (Météo)
- **Rôle** : Météo temps réel + prévisions 3h, impact trafic estimé
- **Dépendances** : OpenMeteo/OpenWeather APIs, StoreEntity
- **Endpoints** : `/weather/:storeId`, `/weather/:storeId/snapshot`
- **Action TimeWin24** : Enrichissement contextuel des données de vente

### 6. transport (Transport public)
- **Rôle** : Stations proches (PRIM/Navitia API), perturbations temps réel
- **Dépendances** : PRIM API, StoreContextEntity
- **Endpoints** : `/transport/:storeId`, `/transport/:storeId/disruptions`
- **Action TimeWin24** : Contexte transport pour corrélation ventes/perturbations

### 7. footfall (Trafic piéton)
- **Rôle** : Découverte lieux proches (Google Places), score de trafic
- **Dépendances** : Google Places API, StoreContextEntity
- **Endpoints** : `/footfall/:storeId`, `/footfall/:storeId/discover`
- **Action TimeWin24** : Scoring localisation magasin

### 8. staffing (Analytics staffing)
- **Rôle** : Snapshots horaires (caissiers actifs, transactions, CA), objectifs staffing
- **Dépendances** : StaffingSnapshotEntity
- **Endpoints** : `/staffing/snapshot`, `/staffing/targets/:storeId`, `/staffing/history/:storeId`
- **Action TimeWin24** : Connecter aux données planning existantes de TimeWin24

## Données conservées dans le POS

Le POS garde les entités suivantes (pas de migration) :
- `store_contexts` (table JSONB — données persistes pour TimeWin24 via sync)
- `staffing_snapshots` (table — historique pour remontée vers TimeWin24)

## NPM packages retirés du POS

- `@anthropic-ai/sdk` — Claude API
- `@google/generative-ai` — Gemini API

Ces packages doivent être installés dans TimeWin24 si nécessaire.
