# Matrice de Tests E2E — CAISSE POS

> Date : 2026-03-28
> Testeur : Claude (automatise)
> Backend : http://localhost:3001 (v1.1.0, status degraded — TimeWin24 externe down)
> Frontend : http://localhost:5173 (Vite dev)

---

## 1. Tests UI (Navigateur Chrome)

| # | Scenario | Page | Resultat | Notes |
|---|---------|------|----------|-------|
| 1 | Login admin (email + PIN) | /login | ✅ OK | PIN `250781`, backend repond 200 |
| 2 | Selection magasin | /select-store | ✅ OK | 3 boutiques affichees (Lyon, Marseille, Paris) |
| 3 | Dashboard CEO | / | ✅ OK | KPIs live (CA 15EUR, 1 ticket aujourd'hui) |
| 4 | Catalogue Produits | /products | ✅ OK | 9 references, stock, EAN, prix |
| 5 | Alertes Stock | /stock-alerts | ✅ OK | 3 alertes live, filtres fonctionnels |
| 6 | Etiquettes | /labels | ✅ OK | Liste produits, formats impression, export ZPL |
| 7 | Stock Reseau | /stock-network | ✅ OK | Page vide (aucun emplacement configure) |
| 8 | Rapports Z | /reports | ✅ OK | Z-Report avec date, moyens paiement, heures pointe |
| 9 | Reglages | /settings | ✅ OK | Config magasin chargee depuis backend |
| 10 | Organisations | /organizations | ✅ OK | Page vide (aucune org) |
| 11 | Unites | /units | ✅ OK | Page vide (aucune unite) |
| 12 | Magasins | /stores | ✅ OK | 3 boutiques actives avec villes |
| 13 | Applications connectees | /connected-apps | ✅ OK | Page vide (aucune app) |
| 14 | Abonnement | /billing | ⚠️ Erreur | "Impossible de charger les informations" (backend API manquante ou Stripe non configure) |
| 15 | Vue Reseau | /network | ✅ OK | CA consolide 4169EUR, 79 tickets, classement |
| 16 | TimeWin24 | /timewin24 | ✅ OK | Page Coming Soon — plus de crash React |
| 17 | Login Employe | /login (tab Employe) | ✅ OK | Formulaire Store ID + PIN affiche |
| 18 | Deconnexion | Sidebar logout | ⚠️ Bug UX | Bouton trop petit (14px), clic difficile |
| 19 | Navigation entre pages | Toutes | ✅ OK | Zero crash React apres fix StoreSwitcher |
| 20 | Session apres reload | F5 sur /products | ✅ OK | Session restauree depuis localStorage |

**Bilan UI : 18/20 OK, 2 bugs mineurs**

---

## 2. Tests API Backend (curl)

| # | Endpoint | Methode | Status HTTP | Resultat | Notes |
|---|---------|---------|-------------|----------|-------|
| 1 | `/api/auth/login/admin` | POST | 200 | ✅ OK | Retourne accessToken + employee + storeInfo |
| 2 | `/api/products` | GET | 200 | ✅ OK | Liste complete des produits |
| 3 | `/api/products/stock-alerts` | GET | 200 | ✅ OK | Alertes et critiques separes |
| 4 | `/api/products` | POST | 201 | ✅ OK | Creation produit "Test Produit E2E" |
| 5 | `/api/products/scan/:ean` | GET | 200 | ✅ OK | Scan EAN retrouve le produit cree |
| 6 | `/api/sales` | GET | **500** | ❌ **BUG** | **TypeError** — endpoint liste ventes casse |
| 7 | `/api/sales` | POST | 201 | ✅ OK | Vente creee (ticket T-000079, hash chain OK) |
| 8 | `/api/stock/alerts` | GET | 200 | ✅ OK | Alertes par magasin |
| 9 | `/api/stock/:id/adjust` | POST | 201 | ✅ OK | Stock ajuste de 10 → 5 |
| 10 | `/api/reports/z-report` | GET | 200 | ✅ OK | Retourne rapport existant |
| 11 | `/api/reports/z-report` | POST | 201 | ✅ OK | Generation Z-Report reussie |
| 12 | `/api/stores/accessible` | GET | 200 | ✅ OK | 3 magasins |
| 13 | `/api/stores/network-summary` | GET | 200 | ✅ OK | Resume reseau (78 ventes, 415400 centimes CA) |
| 14 | `/api/employees` | GET | **404** | ❌ **BUG** | Route non enregistree sur le serveur |
| 15 | `/api/auth/logout` | POST | 200 | ✅ OK | Deconnexion serveur reussie |

**Bilan API : 13/15 OK, 2 bugs**

---

## 3. Bugs trouves

| # | Severite | Module | Description | Impact |
|---|----------|--------|-------------|--------|
| B1 | 🔴 Critique | GET /api/sales | TypeError 500 sur liste des ventes | Page historique ventes inutilisable |
| B2 | 🟡 Moyen | GET /api/employees | Route 404 — non enregistree | Page employes backoffice cassee |
| B3 | 🟡 Moyen | Sidebar logout | Bouton 14px trop petit, clic rate souvent | Apple review : touch target < 44px |
| B4 | 🟢 Mineur | Abonnement | Erreur chargement infos (Stripe non configure) | Normal en dev, masquer en V1 |

---

## 4. Flux valides bout en bout

| Flux | Statut | Detail |
|------|--------|--------|
| Login → Magasin → Dashboard | ✅ Valide | Bout en bout avec backend |
| Creation produit → Catalogue → Stock alerts | ✅ Valide | Produit cree via API apparait dans UI |
| Ajustement stock → Alertes | ✅ Valide | Stock 10→5, alerte remontee |
| Vente → Ticket (API) | ✅ Valide | Ticket T-000079 genere avec hash chain |
| Vente → Dashboard CA | ✅ Valide | CA Aujourd'hui 15EUR visible dans Network |
| Z-Report generation | ✅ Valide | POST genere, GET recupere |
| Navigation toutes pages | ✅ Valide | Zero crash React sur 16 pages |
| Deconnexion serveur | ✅ Valide | API logout 200 OK |

---

## 5. Prochaines actions

1. **Corriger GET /api/sales 500** — TypeError dans le backend
2. **Corriger/ajouter GET /api/employees** — Route manquante
3. **Agrandir bouton logout** — Touch target minimum 44x44px pour Apple
4. **Masquer page Abonnement en V1** — Stripe pas configure
