# Roadmap — The Wesley Control (dashboard direction mobile)

> Créée le 2026-07-12. Règle : chaque étage est livrable, testé, réversible.

## V1 — MVP (cette branche) ✅

- [x] Audit de l'existant (endpoints mobiles, rôles, agrégations, branche
      `feat/owner-mobile-dashboard` historique non mergée)
- [x] API backend lecture seule `GET /api/mobile/v1/direction/*`
      (overview réseau, liste magasins, fiche magasin, comparateur) —
      manager/admin, périmètre par magasin, anti-énumération 404
- [x] App Expo RN : connexion (direction email+PIN / responsable code+PIN),
      accueil réseau, liste magasins, fiche magasin (CA horaire, paiements,
      top produits, retours, écarts de caisse, TPE), alertes (POS-110 réutilisé),
      comparateur (≤10 magasins, jour/7j/30j), réglages
- [x] Biométrie après première connexion, tokens en Keychain/Keystore
- [x] Mode sombre, pull-to-refresh, auto-refresh 60 s, état « données non
      actualisées » (jamais de faux zéro)
- [x] Tests : agrégateurs backend + contrôleur (scope/validation) + app
      (money, freshness) ; CI câblée (`typecheck:control` + `test:control`)
- [ ] Build Android APK (EAS `preview`) — nécessite compte Expo/EAS owner
- [ ] Build iOS TestFlight — nécessite certificats Apple owner

## V1.1 — durcissement

- [ ] SSE réseau consolidé (le backend a déjà `GET /api/realtime/sales` par
      magasin + fan-out Redis) → tuile « ventes en direct »
- [ ] Objectifs journaliers par magasin (table `store_targets` à créer —
      s'inspirer de la branche `feat/owner-mobile-dashboard`, en renumérotant
      ses migrations 1723-1731 qui collisionnent avec 1723-1728 actuelles)
- [ ] Rate limiting dédié (@Throttle) sur /direction si besoin
- [ ] Timezone magasin (aujourd'hui : convention DATE() serveur, identique aux
      rapports back-office — à faire évoluer ensemble)

## V2 — notifications push (STOP owner requis : secrets push)

- [ ] expo-notifications + tokens d'appareil côté backend (schéma `notify_*`
      de la branche historique réutilisable : device tokens, préférences,
      quiet hours, moteur de livraison)
- [ ] Alertes configurables : magasin hors ligne, baisse CA, anomalie caisse,
      stock critique, remboursement important, objectif atteint, TPE déconnecté
- [ ] Révocation distante par appareil

## V2+ — analytics avancés

- [ ] Écran ventes détaillées (recherche ticket, détail lecture seule)
- [ ] Écran produits réseau (top/flop/ruptures/par catégorie — le backend a
      déjà `product-analytics` par magasin)
- [ ] Rapports périodiques + export PDF/partage, comparaison N-1
- [ ] Rôle « responsable régional » de première classe (le modèle n'a pas de
      région : org → unit → store ; en attendant, périmètres multi-magasins via
      `employee_store_access`)
- [ ] Performance par m² (nécessite un champ surface sur `stores`)
