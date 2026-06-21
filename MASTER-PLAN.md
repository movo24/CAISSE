> ⚠️ **SUPERSÉDÉ (2026-06-21) par [`MASTER_ROADMAP.md`](MASTER_ROADMAP.md).** Snapshot historique conservé
> (scope par app, règle de release par couches, checklist Apple). État live : `MASTER_ROADMAP.md` / `PROJECT_STATUS.md`. Ne pas mettre à jour ici.

# MASTER PLAN — CAISSE POS / Inventory / TimeWin24 / Apple

> Dernière mise à jour : 2026-03-28
> Objectif : soumission Apple App Store — POS Caisse V1 en premier

---

## 1. Architecture produit

### 3 applications iOS + 1 backoffice web

| App | Plateforme | Bundle ID | Cible | Priorité |
|-----|-----------|-----------|-------|----------|
| **POS Caisse** | iPad | `com.addxintelligence.poscaisse` | Vendeurs en magasin | **V1 — Première soumission** |
| **Inventaire** | iPhone | `com.addxintelligence.inventory` | Équipe terrain | V2 |
| **TimeWin24** | iPhone | `com.addxintelligence.timewin24` | Employés / RH | V3 |
| **Backoffice** | Web | — | Direction / siège | Web uniquement |

### Pourquoi séparé

- Review Apple plus simple par app
- UX claire, un usage = une app
- Permissions justifiées (caméra scan ≠ pointage ≠ dashboard)
- Moins de bugs, maintenance ciblée
- Soumission progressive = feedback plus rapide

---

## 2. Périmètre par app

### POS Caisse V1 (iPad) — À soumettre en premier

**Inclus :**
- [ ] Login admin (email + PIN)
- [ ] Login employé (Store ID + PIN)
- [ ] Sélection magasin
- [ ] Catalogue produits (recherche, EAN, catégories)
- [ ] Panier / vente
- [ ] Encaissement (espèces, carte bancaire)
- [ ] Ticket digital (QR code + email)
- [ ] Historique tickets (dernier shift)
- [ ] Réglages de base (en-tête ticket, magasin)
- [ ] Connexion imprimante (si stable)
- [ ] Mode erreur propre (pas de crash, pas d'écran vide)

**Exclu V1 (masqué / désactivé) :**
- Dashboard CEO complet
- Pages réseau / organisations / unités
- TimeWin24
- Applications connectées
- Abonnement / facturation
- Stock réseau avancé
- Analytics avancés

### Inventaire V2 (iPhone)

- [ ] Login employé
- [ ] Scan code-barres (caméra)
- [ ] Recherche produit
- [ ] Fiche produit (prix, stock, photo)
- [ ] Ajustement stock (entrée, sortie, casse, vol)
- [ ] Création produit rapide
- [ ] Synchro serveur → POS + dashboard
- [ ] Mode offline partiel

### TimeWin24 V3 (iPhone)

- [ ] Login employé (Store ID + PIN)
- [ ] Pointage entrée / sortie
- [ ] Planning semaine
- [ ] Profil employé
- [ ] Historique présence
- [ ] Synchro dashboard

### Backoffice Web (pas Apple)

- Dashboard CEO
- Rapports / Z-Report / Analytique
- Vue réseau multi-magasins
- Organisations / Unités / Magasins
- Applications connectées
- Abonnement & facturation
- Réglages avancés
- Gestion employés (via TimeWin24 API)

---

## 3. Architecture technique

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  POS iPad   │  │ Inventaire  │  │  TimeWin24  │  │  Backoffice │
│  (native)   │  │  (iPhone)   │  │  (iPhone)   │  │    (web)    │
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       │                │                │                │
       └────────────────┴────────────────┴────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │   Backend NestJS   │
                    │   (API REST)       │
                    ├───────────────────┤
                    │ Auth              │
                    │ Products          │
                    │ Sales             │
                    │ Stock             │
                    │ Employees         │
                    │ Stores            │
                    │ Reports           │
                    │ Audit             │
                    │ Sync              │
                    │ TimeWin24         │
                    │ Devices           │
                    │ Promotions        │
                    │ Customers         │
                    └─────────┬─────────┘
                              │
                    ┌─────────┴─────────┐
                    │   PostgreSQL      │
                    │   (source unique) │
                    └───────────────────┘
```

### Règle vitale

**Une seule source de vérité par donnée.**
- Stock officiel = une table `stock_movements`
- Employé officiel = une table `employees`
- Permissions = un module `roles_permissions`
- Pas de duplication entre POS / Inventaire / TimeWin24

---

## 4. Flux critiques à valider

### Flux 1 — Authentification
| Étape | Statut | Bug connu |
|-------|--------|-----------|
| Login admin (email + PIN) | ✅ Fonctionne | PIN = `1234` (seed) |
| Login employé (Store ID + PIN) | ⚠️ Dépend backend | Backend doit tourner |
| Sélection magasin | ✅ OK | — |
| Persistance session (localStorage) | ✅ OK | Token refresh non testé e2e |
| Logout | ⚠️ Non testé | — |
| Expiration token / refresh | ⚠️ Non testé | — |

### Flux 2 — Produits
| Étape | Statut | Bug connu |
|-------|--------|-----------|
| Affichage catalogue | ✅ OK | — |
| Recherche / filtre | ⚠️ Non testé e2e | — |
| Création produit | ⚠️ Non testé e2e | — |
| Scan EAN | ⚠️ Non testé | Dépend caméra |
| Synchro → POS + dashboard | ⚠️ Non validé | Flux critique |

### Flux 3 — Inventaire → POS → Dashboard
| Étape | Statut | Bug connu |
|-------|--------|-----------|
| Scan produit | ⚠️ Non testé | — |
| Ajustement stock | ⚠️ Non testé | — |
| Remontée POS | ⚠️ Non validé | **Flux critique #1** |
| Remontée dashboard | ⚠️ Non validé | — |
| Alertes stock | ✅ UI OK | Données pas testées e2e |

### Flux 4 — Vente / Ticket
| Étape | Statut | Bug connu |
|-------|--------|-----------|
| Ajout panier | ⚠️ Non testé | — |
| Encaissement | ⚠️ Non testé | — |
| Ticket digital (QR) | ⚠️ Non testé | — |
| Envoi email ticket | ⚠️ Non testé | — |
| Historique tickets | ⚠️ Non testé | — |

### Flux 5 — TimeWin24
| Étape | Statut | Bug connu |
|-------|--------|-----------|
| Page Coming Soon | ✅ OK | Page placeholder active |
| Login employé dédié | ⚠️ Non implémenté | V3 |
| Pointage | ⚠️ Non implémenté | V3 |

### Flux 6 — Périphériques
| Étape | Statut | Bug connu |
|-------|--------|-----------|
| Imprimante | ⚠️ Non testé hardware | — |
| Scanner | ⚠️ Non testé hardware | — |
| Tiroir-caisse | ⚠️ Non testé hardware | — |

---

## 5. Bugs connus

| # | Sévérité | Module | Description | Statut |
|---|----------|--------|-------------|--------|
| 1 | 🔴 Critique | StoreSwitcher.tsx | `useEffect` après `return null` conditionnel → crash React | ✅ **CORRIGÉ** |
| 2 | 🔴 Critique | API (3 apps) | Pas de timeout axios → UI bloquée si backend down | ✅ **CORRIGÉ** — timeout 15s |
| 3 | 🔴 Critique | API (backoffice+POS) | Token refresh queue pas drainée en cas d'échec → boucle 401 | ✅ **CORRIGÉ** — onRefreshFailed() |
| 4 | 🔴 Critique | API (mobile) | Auth header pas nettoyé après logout → credentials leakées | ✅ **CORRIGÉ** — delete + reject |
| 5 | 🔴 Critique | API (3 apps) | JWT parsing sans validation structure → DOS par corruption | ✅ **CORRIGÉ** — validation 3 parts + exp |
| 6 | 🔴 Critique | POS Desktop | Logout n'appelle pas l'API serveur → token volé valide 7j | ✅ **CORRIGÉ** — authApi.logout() ajouté |
| 7 | 🔴 Critique | Login backoffice | Email/StoreID persistés à chaque keystroke → privacy leak | ✅ **CORRIGÉ** — persisté uniquement après login réussi |
| 8 | 🟡 Moyen | POS / Mobile | `.catch(() => {})` silencieux sur flux critiques (print, drawer, produits) | ✅ **CORRIGÉ** — console.warn ajouté |
| 9 | 🟡 Moyen | Login | Backend requis pour login — pas de mode offline/demo | Ouvert |
| 10 | 🟡 Moyen | Abonnement | "Impossible de charger les informations d'abonnement" | Ouvert |
| 11 | 🟢 Mineur | Navigation | Navigation par URL directe crashait (lié au bug #1) | ✅ CORRIGÉ |

---

## 6. Checklist Apple

### Compte développeur
- [ ] Apple Developer Program actif
- [ ] Nom légal éditeur configuré
- [ ] Certificats de distribution créés
- [ ] Provisioning profiles générés

### Par application
- [ ] Bundle ID enregistré
- [ ] Icône 1024x1024
- [ ] Splash screen
- [ ] Screenshots (iPad pour POS, iPhone pour Inventaire/TimeWin24)
- [ ] Description App Store
- [ ] Catégorie (Business / Productivity)
- [ ] Politique de confidentialité (URL)
- [ ] URL de support
- [ ] Compte démo pour reviewer Apple
- [ ] Pas de boutons morts
- [ ] Pas d'écrans vides
- [ ] Pas de crash
- [ ] Permissions justifiées (caméra, réseau local, Bluetooth)

### Tests pré-soumission
- [ ] Test sur vrai iPad (POS)
- [ ] Test sur vrai iPhone (Inventaire / TimeWin24)
- [ ] Test compte vierge (premier lancement)
- [ ] Test connexion lente
- [ ] Test sans backend (message d'erreur propre)
- [ ] Test permissions refusées
- [ ] TestFlight beta validée
- [ ] Crash monitoring actif (Sentry ou équivalent)

---

## 7. Roadmap 30 jours

### Semaine 1 — Stabilisation (J1-J7)

**Objectif :** zéro crash, environnement stable

- [ ] Audit complet hooks React (tous les composants)
- [ ] Audit `return null` conditionnels avant hooks
- [ ] Audit auth / session restore / token refresh
- [ ] Audit erreurs réseau (messages propres, pas de crash)
- [ ] Backend healthcheck automatique
- [ ] Corriger logs silencieux
- [ ] Liste bugs critiques avec statut

**Livrable :** environnement dev stable, liste bugs classifiée

### Semaine 2 — Flux métier (J8-J14)

**Objectif :** 20 scénarios testés, zéro crash sur parcours critiques

- [ ] Login admin → magasin → dashboard : bout en bout
- [ ] Login employé → POS : bout en bout
- [ ] Création produit → apparition catalogue → stock
- [ ] Vente → ticket digital → historique
- [ ] Ajustement stock → alerte stock → dashboard
- [ ] Rapport Z → impression/export
- [ ] Déconnexion → reconnexion → session valide
- [ ] Navigation entre toutes les pages sans crash

**Livrable :** matrice de tests validée

### Semaine 3 — Préparation Apple (J15-J21)

**Objectif :** build candidate iOS propre

- [ ] Définir périmètre exact V1 POS
- [ ] Masquer/désactiver modules pas prêts
- [ ] Écrans d'erreur propres partout
- [ ] Onboarding premier lancement
- [ ] Icône + splash screen
- [ ] Privacy policy publiée
- [ ] Métadonnées App Store rédigées
- [ ] Screenshots capturées

**Livrable :** build iOS prête pour TestFlight

### Semaine 4 — QA + Soumission (J22-J30)

**Objectif :** soumission Apple sans carnage

- [ ] Tests sur vrais appareils
- [ ] Test compte vierge
- [ ] Test connexion lente / coupée
- [ ] Test permissions refusées
- [ ] TestFlight beta distribuée
- [ ] Corrections finales
- [ ] Soumission App Store

**Livrable :** app POS Caisse V1 soumise

---

## 8. Tableau de guerre

| Module | Statut | Bug critique | Backend requis | Hardware requis | Prêt Apple | Version |
|--------|--------|-------------|----------------|-----------------|------------|---------|
| Login Admin | 🟢 OK | Non | Oui | Non | ⚠️ Tester | V1 |
| Login Employé | 🟡 Partiel | Backend offline | Oui | Non | ⚠️ Tester | V1 |
| Sélection magasin | 🟢 OK | Non | Cache OK | Non | ⚠️ Tester | V1 |
| Dashboard CEO | 🟢 OK | Non | Oui | Non | Non (V2) | V2 |
| Catalogue Produits | 🟢 OK | Non | Oui | Non | ✅ Candidat V1 | V1 |
| Alertes Stock | 🟢 OK | Non | Oui | Non | ✅ Candidat V1 | V1 |
| Étiquettes | 🟢 OK | Non | Oui | Imprimante | Non (V2) | V2 |
| Stock Réseau | 🟢 OK | Non | Oui | Non | Non (V2) | V2 |
| Rapports | 🟢 OK | Non | Oui | Non | ✅ Candidat V1 | V1 |
| Organisations | 🟢 OK | Non | Oui | Non | Non (web) | Web |
| Unités | 🟢 OK | Non | Oui | Non | Non (web) | Web |
| Magasins | 🟢 OK | Non | Oui | Non | Non (web) | Web |
| Apps connectées | 🟢 OK | Non | Oui | Non | Non (web) | Web |
| Abonnement | 🟡 Erreur | Chargement KO | Oui | Non | Non (web) | Web |
| Réglages | 🟢 OK | Non | Oui | Non | ✅ Candidat V1 | V1 |
| Vue Réseau | 🟢 OK | Non | Oui | Non | Non (web) | Web |
| TimeWin24 | 🟢 Placeholder | Non | — | Non | Non (V3) | V3 |

---

## 9. Décisions à prendre

1. **Technologie mobile :** React Native / Expo vs natif Swift ?
2. **Mode offline POS :** quel niveau de cache local ? SQLite / AsyncStorage ?
3. **Périphériques :** SDK imprimante/scanner choisi ?
4. **Domaine privacy policy :** URL hébergée où ?
5. **Compte Apple Developer :** individuel ou organisation ?
6. **Nom commercial App Store :** "CAISSE POS" ? "AddX POS" ? Autre ?

---

> **Règle d'or :** Pas de nouvelle feature tant que les flux critiques ne sont pas validés bout en bout.
