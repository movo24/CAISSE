# AUDIT FINAL — CAISSE POS + TimeWin24
> Date : 2026-04-01
> Mode : Lecture seule — zero modification
> Scope : Local + Production + TimeWin24 Production

---

## 🔴 CRITIQUES (bloquants business)

| # | Probleme | Impact | Localisation |
|---|---------|--------|-------------|
| 1 | **PIN login 500 en PROD** — POST /api/auth/login/pin retourne 500 (Internal Server Error) pour tous les PINs | **POS inutilisable** — aucun employe ne peut se connecter au POS en production | Backend prod — auth.service.ts |
| 2 | **Cles API reelles dans git** — PRIM_API_KEY et GOOGLE_MAPS_API_KEY commitees dans docker/.env.production.example | **Securite compromise** — cles dans l'historique git, a considerer comme leakees | `docker/.env.production.example` |
| 3 | **StockAlertsPage avale les erreurs** — catch vide, utilisateur voit "0 alertes" quand l'API echoue | **Faux sentiment de securite** — stock peut etre critique sans que personne le sache | `StockAlertsPage.tsx:153` |
| 4 | **XSS dans receipts HTML** — noms produits/employes/magasins injectes dans HTML sans echappement | **Faille securite** — execution JS dans le navigateur du client | `receipts.controller.ts:128-143` |

---

## 🟠 IMPORTANTS (degradent l'experience)

| # | Probleme | Impact | Localisation |
|---|---------|--------|-------------|
| 5 | **TimeWin24 DOWN** — circuit breaker OPEN sur local ET prod, shifts inaccessibles | Planning/pointage non fonctionnels | Les 2 environnements |
| 6 | **Redis "unknown" en prod** — health reporte Redis comme inconnu | Token revocation peut ne pas fonctionner en multi-instance | Backend prod |
| 7 | **Receipts sans auth** — /api/receipts/:saleId public, expose SIRET/adresse/employes | Donnees business accessibles par UUID | `receipts.controller.ts` |
| 8 | **Boutons morts** — Exporter (produits), Imprimer (rapports), Exporter CSV, Configurer connexion | UX cassee — boutons visibles sans action | `ProductsPage:241`, `ReportsPage:170,408,475` |
| 9 | **Employee/User desync TW24** — 2 employes inactifs mais Users encore actifs | Login possible avec compte desactive | TimeWin24 prod DB |
| 10 | **PosStoreLink/PosEmployeeLink vides** — tables de mapping POS↔TW24 jamais populees | Integration formelle absente | TimeWin24 prod DB |
| 11 | **Stock alerts sans pagination** — getStockAlerts() charge TOUS les produits sous seuil | Lent sur gros catalogues | `products.service.ts:210` |
| 12 | **LabelsPage erreurs silencieuses** — console.error seulement, rien affiche a l'utilisateur | Page vide sans explication | `LabelsPage.tsx:72` |

---

## 🟡 MINEURS (cosmetiques / dette)

| # | Probleme | Localisation |
|---|---------|-------------|
| 13 | Fautes dans noms magasins prod ("dirction", "fontaine") | Base prod stores |
| 14 | "Test Store" (LYO-001) actif en production | Base prod stores |
| 15 | printTicketMock() console.log sur chaque vente | `sales.service.ts:770` |
| 16 | colSpan=6 au lieu de 7 dans ProductsPage (layout casse) | `ProductsPage.tsx:417` |
| 17 | DashboardPage n'affiche pas de loading spinner | `DashboardPage.tsx:140` |
| 18 | Local DB completement vide vs prod (pas de parite) | Environnement local |

---

## ⚙️ DETTE TECHNIQUE

| # | Probleme | Localisation |
|---|---------|-------------|
| 19 | 40+ imports/variables inutilises dans le frontend | 12 fichiers |
| 20 | useDashboardData.ts — 10+ state setters jamais utilises | `useDashboardData.ts` |
| 21 | Dynamic table names dans SQL (fragile pattern) | `stores.service.ts:247` |
| 22 | getPriceAnalytics() — boucle de queries SQL (N+1) | `products.service.ts:319` |
| 23 | StockNetworkPage appelle productsApi.list() sans storeId | `StockNetworkPage.tsx:97` |

---

## 🔐 SECURITE

| # | Probleme | Severite | Localisation |
|---|---------|----------|-------------|
| S1 | Cles API dans historique git | 🔴 Critique | `docker/.env.production.example` |
| S2 | XSS dans receipts HTML | 🔴 Critique | `receipts.controller.ts` |
| S3 | Receipts public sans auth | 🟠 Important | `/api/receipts/:saleId` |
| S4 | Employee desactive peut encore login (TW24) | 🟠 Important | TimeWin24 User table |
| S5 | CORS bien configure | ✅ OK | `main.ts` |
| S6 | JWT secrets forts (64 chars hex) | ✅ OK | `.env` |
| S7 | Bcrypt 12 rounds pour PINs | ✅ OK | `auth.service.ts` |
| S8 | TenantInterceptor global | ✅ OK | `main.ts` |

---

## 🧠 INCOHERENCES PRODUIT

| # | Probleme | Impact |
|---|---------|--------|
| P1 | Local et prod ont des stores/employes/produits differents — aucune parite | Tests locaux ne refletent pas la prod |
| P2 | 8 stores sur 9 en prod ont 0 ventes — seulement Boutique Paris a du CA | Dashboard reseau affiche des magasins fantomes |
| P3 | Analytics tab dans Rapports = placeholder complet avec faux boutons | Feature vendue visuellement mais inexistante |
| P4 | PIN login casse en prod mais fonctionne en local | Code deploye different ou DB prod incompatible |

---

## PERFORMANCE

| Endpoint | Temps | Verdict |
|----------|-------|---------|
| GET /api/health | 58ms (warm) / 131ms (cold) | ✅ Excellent |
| GET /api/products | 140ms | ✅ OK |
| GET /api/sales | 180ms | ✅ OK |
| GET /api/stores/network-summary | 300ms | ✅ OK |
| GET /api/stores/accessible | 70ms | ✅ Excellent |

**Risques sous charge :**
- `getStockAlerts()` sans LIMIT → lent sur gros catalogue
- `getPriceAnalytics()` N+1 queries → lent si beaucoup de changements prix

---

## COHERENCE DATA

| Check | Local | Prod |
|-------|-------|------|
| Orphelins sale_line_items | 0 ✅ | 0 ✅ |
| Orphelins sale_payments | 0 ✅ | 0 ✅ |
| Orphelins products | 0 ✅ | 0 ✅ |
| Orphelins employees | 0 ✅ | 0 ✅ |
| Doublons EAN/store | 0 ✅ | 0 ✅ |
| Doublons email employe | 0 ✅ | 0 ✅ |
| Valeurs impossibles | 0 ✅ | 0 ✅ |
| Store IDs POS = TW24 | — | ✅ Alignes |

---

## PRIORITES CORRECTIVES (ordre recommande)

| Rang | Probleme | Effort | Impact |
|------|---------|--------|--------|
| **1** | PIN login 500 en prod | 1h | Debloque le POS en production |
| **2** | Rotater les cles API leakees | 30min | Securite |
| **3** | Echapper HTML dans receipts (XSS) | 30min | Securite |
| **4** | StockAlertsPage — afficher les erreurs | 15min | Fiabilite |
| **5** | Desactiver boutons morts ou les implementer | 1h | UX |
| **6** | LabelsPage — afficher erreurs | 15min | UX |
| **7** | Paginer getStockAlerts() | 30min | Performance |
| **8** | Sync Employee/User status dans TW24 | 30min | Securite |
