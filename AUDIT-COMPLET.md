# AUDIT COMPLET — CAISSE POS / AddX Intelligence

> Date : 2026-03-28
> Methode : 3 agents paralleles (backend, frontend, securite+paiements)
> Perimetre : 4 packages (backend, backoffice-web, pos-desktop, mobile)
> Objectif : photographie reelle, zero correction

---

## 1. ETAT GLOBAL DU SYSTEME

### Fonctionnalites OPERATIONNELLES (testees e2e)
- ✅ Login admin (email + PIN) + fallback local
- ✅ Login employe (storeId + PIN) + fallback local
- ✅ Selection magasin (3 stores)
- ✅ Switch scope global/store (sidebar refondee)
- ✅ Catalogue produits (CRUD, filtre par store)
- ✅ Alertes stock (seuils, ruptures, critiques)
- ✅ Vente (creation, hash chain, ticket)
- ✅ Z-Report (generation + consultation)
- ✅ Ajustement stock
- ✅ Scan EAN
- ✅ Vue reseau (CA consolide, classement magasins)
- ✅ Gestion magasins (CRUD, activation/desactivation)
- ✅ Gestion employes (CRUD, PIN, QR badge)
- ✅ Organisations / Unites (CRUD)
- ✅ Applications connectees (CRUD)
- ✅ Logout (serveur + client, revocation token)

### Fonctionnalites PARTIELLES ou INSTABLES
- ⚠️ Dashboard KPIs : ne filtre PAS par store selectionne (affiche global partout)
- ⚠️ GET /api/sales : corrige mais non teste en conditions de charge
- ⚠️ Stripe Terminal : flux SDK OK mais PaymentIntent pas lie au sale record
- ⚠️ Etiquettes : fonctionnel UI mais impression hardware non testee
- ⚠️ Abonnement/Billing : erreur chargement (Stripe non configure en dev)
- ⚠️ Stock reseau : double systeme (product.stockQuantity vs StockBalanceEntity) sans synchro
- ⚠️ StoreSwitcher : clic natif ne fonctionne pas toujours (conflit mousedown listener)

### Fonctionnalites NON TERMINEES
- ❌ QR code login : pas de fallback local si TimeWin24 down
- ❌ Refund/remboursement : aucun endpoint (cancel seulement pour paiements non captures)
- ❌ Historique achats client : aucun endpoint
- ❌ Mise a jour client : aucun endpoint PUT /customers/:id
- ❌ Suppression promotion : aucun endpoint DELETE
- ❌ Export rapports (CSV/PDF) : aucun
- ❌ Notifications SMS/email : endpoint existe mais ne fait que console.log
- ❌ Planning/shifts local : depend entierement de TimeWin24 (pas de cache local)
- ❌ Pointage : depend entierement de TimeWin24
- ❌ Register sessions : PosSessionEntity importee mais jamais utilisee

---

## 2. ARCHITECTURE (RESPECT DES ETAGES)

### Ce qui est BIEN structure
- ✅ Separation backend modules NestJS (26 modules actifs, bien decoupe)
- ✅ TenantInterceptor global (isolation multi-store)
- ✅ Role guards (cashier < manager < admin)
- ✅ Circuit breaker TimeWin24 (resilience)
- ✅ Offline queue avec HMAC signing
- ✅ Hash chain audit (SHA-256, append-only)
- ✅ Nouvelle sidebar par couches metier (Layout refonde)
- ✅ useAppScope hook (contexte maitre global/store)

### Ce qui est MAL structure ou MELANGE
- ❌ Pages mortes dans `_migrated-to-timewin24/` (30+ fichiers, bruit cognitif)
- ❌ 3 fichiers `.bak` dans `database/entities/` (risque autoLoadEntities)
- ❌ `POSPage.tsx` (1738 lignes) reimplemente tout le flux paiement deja extrait dans `usePayment.ts`
- ❌ Dual stock : `product.stockQuantity` (legacy) vs `StockBalanceEntity` (nouveau) sans synchro
- ❌ DTOs inline dans certains controllers au lieu de `common/dto/`
- ❌ `currencyCode: 'EUR'` hardcode dans sales.service.ts
- ❌ `taxRate: 20` hardcode dans receipts

### Incoherences entre modules
- Employees existe en 2 versions : actif (`modules/employees/`) ET mort (`_migrated-to-timewin24/employees_removed/`)
- Sales utilise `product.stockQuantity` pour decrementer, StockLocations utilise `StockBalanceEntity` — les deux systemes de stock ne se parlent pas
- Dashboard KPIs viennent de `networkSummary` (global) meme quand un store est selectionne

---

## 3. FLUX DE DONNEES

### POS → Backend : ✅ OK
- Ventes creees via POST /api/sales, hash chain validee
- Stock decremente sur vente (product.stockQuantity)
- Audit log cree (fire-and-forget, peut avoir des gaps)

### Inventory → POS : ⚠️ PARTIEL
- Scan EAN fonctionne
- Ajustement stock fonctionne (product.stockQuantity)
- MAIS : StockLocationsModule (entrepots) ne met PAS a jour product.stockQuantity
- Donc : un transfert inter-entrepot ne change pas le stock visible dans le POS

### Dashboard → Backend : ⚠️ CRITIQUE
- `useDashboardData` appelle `productsApi.list({ storeId })` — filtre OK
- MAIS `storesApi.networkSummary()` retourne un total global — PAS filtre par store
- DONC les KPIs CA Jour/Semaine/Mois sont FAUX quand un store est selectionne

### TimeWin24 → POS : ⚠️ FRAGILE
- Quand TimeWin24 est up : employes, shifts, pointage fonctionnent via proxy
- Quand TimeWin24 est down : auth PIN fallback local OK, mais shifts/planning = 0 donnees
- Pas de cache local pour les shifts

### Points de rupture
1. **Stock dual** : vente decremente `product.stockQuantity`, mais StockLocations ne voit pas le changement
2. **Dashboard KPIs** : `networkSummary` est global, pas filtre par store
3. **PIN sync** : si un employe change son PIN dans TimeWin24, le pinHash local n'est PAS mis a jour

---

## 4. SOURCE DE VERITE DES DONNEES

| Donnee | Source de verite | Risque |
|--------|-----------------|--------|
| Produits | PostgreSQL `products` table | ✅ OK — une seule source |
| Ventes | PostgreSQL `sales` table | ✅ OK — immutable, hash chain |
| Paiements | PostgreSQL `sale_payments` | ⚠️ `stripePaymentIntentId` jamais ecrit → impossible de reconcilier avec Stripe |
| Stock (POS) | `product.stockQuantity` | ⚠️ Pas synchro avec `StockBalanceEntity` |
| Stock (entrepot) | `stock_balances` table | ⚠️ Pas synchro avec `product.stockQuantity` |
| Employes | PostgreSQL `employees` + TimeWin24 | ⚠️ Deux sources, PIN peut diverger |
| Clients | PostgreSQL `customers` | ✅ OK mais pas de PUT/DELETE |

---

## 5. PAIEMENT / STRIPE TERMINAL

### Ce qui FONCTIONNE
- ✅ Connection token pour SDK initialization
- ✅ PaymentIntent creation avec idempotency (MAIS voir bug ci-dessous)
- ✅ Store isolation (verifie metadata.storeId)
- ✅ Double-charge prevention (activePaymentRef lock)
- ✅ Timeout 2 minutes sur collection carte
- ✅ Retry avec backoff (2 retries, 1.5s delay)

### Ce qui peut CASSER en production
- 🔴 **Idempotency key inclut `Date.now()`** → un retry 1ms plus tard genere une nouvelle cle → DOUBLE CHARGE possible
- 🔴 **`stripePaymentIntentId` jamais ecrit dans `SalePaymentEntity`** → impossible de reconcilier ventes/paiements Stripe
- 🔴 **Pas de refund endpoint** pour paiements captures (seulement cancel pour non-captures)
- 🟡 **Pas de webhook Stripe Terminal** (payment_intent.payment_failed, reader.action_failed)
- 🟡 **Stripe en mode test** (sk_test) — normal en dev, mais a switcher avant prod

### Gestion erreurs
- Timeout reseau : ✅ gere (AbortController + Promise.race)
- Refus carte : ✅ gere (erreur propagee au frontend)
- Perte connexion mid-payment : ⚠️ pas de recovery automatique

---

## 6. BUGS CONNUS

| # | Severite | Module | Description | Localisation |
|---|----------|--------|-------------|-------------|
| 1 | 🔴 BLOQUANT | Dashboard | KPIs (CA, tickets, panier moyen) affichent le GLOBAL au lieu du store selectionne | `useDashboardData.ts` → `networkSummary()` |
| 2 | 🔴 BLOQUANT | Stripe | Idempotency key avec `Date.now()` → double charge possible | `stripe-terminal.service.ts:41` |
| 3 | 🔴 BLOQUANT | Stripe | `stripePaymentIntentId` jamais lie au sale → pas de reconciliation | `sales.service.ts:293-301` |
| 4 | 🔴 BLOQUANT | DB | ZERO fichier de migration → deploiement prod sur DB vierge = crash | `database/migrations/` (vide) |
| 5 | 🟡 MAJEUR | Stock | Dual system (product.stockQuantity vs StockBalanceEntity) sans synchro | Modules Sales vs StockLocations |
| 6 | 🟡 MAJEUR | Auth | `logout()` pas `await` dans controller → revocation peut echouer silencieusement | `auth.controller.ts:138` |
| 7 | 🟡 MAJEUR | POS | POSPage.tsx reimplemente le flux paiement avec timeout 7s au lieu de 30s (usePayment) | `POSPage.tsx:103` |
| 8 | 🟡 MAJEUR | POS | `lastSaleId` stocke via `(store as any)` → bypass TypeScript, pas reactif | `usePayment.ts:166` |
| 9 | 🟡 MAJEUR | Sync | Detection conflit stock = no-op (code commente, retourne toujours `hasConflict: false`) | `syncEngine.ts:65-81` |
| 10 | 🟡 MAJEUR | Sales | `currencyCode: 'EUR'` hardcode → casse pour magasins non-EUR | `sales.service.ts:282,299` |
| 11 | 🟡 MAJEUR | Receipts | `taxRate: 20` hardcode → faux pour taux reduits | `receipts:68` |
| 12 | 🟢 MINEUR | Frontend | Zero attributs ARIA dans les 3 apps → accessibilite = 0 | Toutes les apps |
| 13 | 🟢 MINEUR | Frontend | 9 pages mortes dans `_migrated-to-timewin24/` shippees dans le bundle | `backoffice-web/pages/` |
| 14 | 🟢 MINEUR | Backend | 30+ fichiers morts dans `_migrated-to-timewin24/` | `backend/modules/` |
| 15 | 🟢 MINEUR | Network | Event listeners `window.addEventListener` jamais retires dans syncEngine | `syncEngine.ts:302-316` |
| 16 | 🟢 MINEUR | BT | GATT event listeners jamais retires apres unmount | `useBluetoothScanner.ts` |

---

## 7. QUALITE DU CODE

### Duplications critiques
| Code duplique | Occurrences | Impact |
|--------------|-------------|--------|
| JWT interceptor (isTokenExpired, refresh, queue) | 3x (api.ts dans chaque app) | Bug fixe dans un = reste casse dans les 2 autres |
| ErrorBoundary.tsx | 3x (byte-for-byte identique) | Devrait etre dans @caisse/shared |
| initials() + avatarColor() + formatPrice() | 2x (POSPage + IPadPOSLayout) | Devrait etre dans utils/ |
| CatalogueProduct interface | 2x (POSPage + useCart) | Peuvent diverger |
| isTokenExpired() | 4x (3 api.ts + 1 authStore) | Meme logique copiee partout |

### Dette technique
- `any` abuse : 15+ endpoints API avec `data: any` au lieu de DTOs types
- `PosSessionEntity` importee mais jamais utilisee (register sessions pas implementees)
- `printTicketMock()` dans SalesService ecrit en console (devrait utiliser ReceiptsModule)
- `createLocation()` dans StripeTerminalService sans endpoint controller
- Payroll calculator (400 lignes) = dead code dans le bundle

### Zones a risque
- `POSPage.tsx` : 1738 lignes, reimplemente usePayment, CatalogueProduct, helpers — fichier monstre
- `IPadPOSLayout.tsx` : 49KB, meme pattern
- `useDashboardData.ts` : melange scope global et store, PerfData interface incomplete
- Audit hash chain : pas de row-level locking → concurrent writes peuvent corrompre la chaine

---

## 8. PERFORMANCE

### Temps de reponse
- Login : < 500ms (bcrypt 12 rounds)
- Products list : < 100ms (9 produits)
- Network summary : < 200ms (SQL aggregation)
- Dashboard load : ~1-2s (multiple Promise.allSettled)

### Points de blocage
- `eager: true` sur Sale → LineItems + Payments : chaque query sale charge TOUT → O(n) sur grosses bases
- POSPage fetch catalogue une seule fois au mount, jamais refresh → stock stale pour toute la session
- IPadPOSLayout fetch catalogue toutes les 15s → 2 comportements differents selon le layout

### Risques en charge
- Pas de pagination sur `GET /products` dans le POS (charge tous les produits d'un coup)
- `networkSummary` fait un full scan des ventes pour aggreger → lent avec des milliers de ventes
- Redis requis pour token revocation multi-instance — sans Redis, in-memory = pas partage entre instances

---

## 9. SECURITE

### ✅ Points forts
- JWT secrets 64 chars hex, valides au demarrage, pas hardcodes
- Bcrypt 12 rounds pour PINs
- Token replay detection (JTI family tracking)
- TenantInterceptor global (isolation multi-store)
- CORS restrictif (whitelist, pas wildcard)
- HMAC-SHA256 pour offline queue (reel, pas placeholder)
- Stripe store isolation (metadata.storeId verifie)
- Constant-time HMAC verification (anti timing attack)

### ⚠️ Points faibles
- Offline queue localStorage en clair (pas de chiffrement au repos)
- Pas de lockdown device apres offline prolonge
- `ConnectedAppsModule` : pas de guard sur organizationId → any user peut query any org
- `TerminalsModule PATCH /:id` : pas de tenant check → any user peut modifier any terminal
- `JackpotModule` : fallback silencieux au lieu de 403 si storeId ne match pas
- API keys (Anthropic, Gemini, Google Maps) dans .env — OK si .gitignore mais attention au VCS

### ❌ Manquant
- Pas de chiffrement localStorage offline
- Backend ne valide pas les signatures HMAC sur sync (seulement le frontend signe)
- Pas de revocation de session quand un store est archive/desactive

---

## 10. UI / UX TERRAIN

### Utilisable en magasin
- ✅ Login PIN : rapide, clair
- ✅ Catalogue : recherche, EAN, categories
- ✅ IPadPOSLayout : 3 colonnes, touch-optimise, scanner camera
- ✅ Switch magasin : fonctionne visuellement

### Lent ou confus
- ⚠️ POSPage desktop : 1738 lignes, timeout ticket 7s (trop court pour scanner QR)
- ⚠️ StoreSwitcher : clic natif rate souvent (conflit mousedown/click events)
- ⚠️ Bouton logout : 44x44px maintenant mais toujours en bas de sidebar (pas intuitif)
- ⚠️ Pas de loading skeleton sur les pages qui fetchent (ecran blanc pendant le chargement)

### Actions critiques mal placees
- Deconnexion cache en bas de sidebar (devrait etre dans un menu utilisateur)
- Pas de confirmation avant void/annulation de vente
- Pas d'indicateur visuel "mode offline" dans le POS

---

## 11. ECART THEORIE vs REALITE

| Prevu | Realite |
|-------|---------|
| Multi-store avec scope global/store | ✅ Scope switching fonctionne MAIS dashboard KPIs pas filtres |
| Stripe Terminal paiement carte | ⚠️ SDK flow OK mais PaymentIntent pas lie aux ventes |
| Offline-first POS | ⚠️ Queue existe, HMAC signe, MAIS conflit detection = no-op |
| Audit chain inviolable | ⚠️ SHA-256 correct MAIS pas de row locking → corruption possible concurrent |
| Multi-devise | ❌ Hardcode EUR partout |
| Notifications SMS/email | ❌ Console.log uniquement |
| Planning/shifts | ❌ Depend 100% TimeWin24, zero cache local |
| Register sessions (ouverture/fermeture caisse) | ❌ Entity existe mais jamais utilisee |
| Database migrations production | ❌ Zero fichier de migration |

---

## 12. TOP 10 PRIORITES CORRECTIVES

| # | Priorite | Description | Bloque prod ? |
|---|----------|-------------|--------------|
| **1** | 🔴 P0 | Dashboard KPIs : filtrer par store selectionne (pas networkSummary global) | OUI — donnees fausses |
| **2** | 🔴 P0 | Creer fichiers de migration DB (zero migration = crash sur DB vierge) | OUI — deploiement impossible |
| **3** | 🔴 P0 | Fix idempotency key Stripe (retirer Date.now() → deterministe) | OUI — double charge possible |
| **4** | 🔴 P0 | Lier stripePaymentIntentId au SalePaymentEntity | OUI — pas de reconciliation comptable |
| **5** | 🟡 P1 | Synchroniser dual stock (product.stockQuantity ↔ StockBalanceEntity) | Fonctionnel mais donnees incohérentes |
| **6** | 🟡 P1 | Await logout() dans auth controller | Revocation peut echouer silencieusement |
| **7** | 🟡 P1 | Extraire code duplique dans @caisse/shared (JWT interceptor, ErrorBoundary) | Dette technique croissante |
| **8** | 🟡 P1 | Supprimer _migrated-to-timewin24/ (30+ fichiers morts) | Bruit cognitif |
| **9** | 🟡 P2 | Implementer detection conflit stock offline (actuellement no-op) | Risque integrite données |
| **10** | 🟡 P2 | Retirer hardcode EUR/taxRate 20 → lire depuis store config | Casse pour non-EUR |

---

## VERDICT FINAL

**Le systeme est fonctionnel pour un MVP mono-devise (EUR) avec 1-3 magasins.**

**Il n'est PAS production-ready pour :**
- Multi-devise
- Forte charge (> 100 ventes/jour)
- Deploiement sur DB vierge (zero migrations)
- Comptabilite Stripe (PaymentIntent non lie)
- Mode offline reel (conflit detection = no-op)

**Les 4 items P0 doivent etre corriges avant toute mise en production.**
