# INTEGRATION_REMEDIATION_PLAN — Plan de correction des connexions

> Issu de l'audit 2026-07-10 (`AUDIT_INTEGRATIONS_COMPLETE.md`). Blocs autonomes, testables, réversibles.
> ⚠️ = contient une opération Tier-2 (prod/DNS/paiement/migration) → **GO owner nommé requis**.
> Aucun bloc n'est commencé sans présentation du verdict (fait) et GO.

## Bloc N1 — ⚠️ Garde-fou sync magasins TW24 (P1, risque prod le plus grave)
- **Objectif** : une liste TW24 vide ne doit JAMAIS désactiver le réseau local.
- **Fichiers** : `stores.service.ts:390-399` — refuser la désactivation en masse si `twStores.length === 0` (ou seuil de sécurité), journaliser un `STORE_SYNC_REFUSED`, renvoyer une erreur explicite au lieu d'éteindre. Distinguer 502 (auth) vs 200-liste-vide (I15).
- **Tests** : sync avec liste vide → aucun magasin désactivé + erreur ; sync avec liste partielle → seuls les absents réellement retirés ; auth manquante → 502 sans mutation. (Actuellement 0 test, et le spec existant mocke des méthodes inexistantes → à réécrire.)
- **Risque** : la logique touche les magasins (structure). Additif/défensif mais **sensible → GO owner**.
- **Terminé quand** : test « liste vide ne casse rien » vert, spec stores réaligné sur les vraies méthodes.

## Bloc N2 — Endpoints POS morts (weather / occupancy-weather) (P2)
- **Objectif** : plus aucun 404 au démarrage POS.
- **Fichiers** : POS `usePOSLifecycle.ts:101` + `POSPage.tsx:403` + `api.ts` (retirer `weatherApi`, `occupancyApi.getWeather`), OU réintroduire un proxy météo si la donnée est voulue (décision produit — la météo a été « migrée TimeWin24 » sans consommateur). Recommandation : retirer les appels morts.
- **Tests** : garde source « aucun appel `weatherApi`/`getWeather` dans le renderer ».
- **Risque** : faible (front, suppression d'appels 404). **Terminé quand** : POS boot sans 404 météo.

## Bloc N3 — CORS & base URL prod cohérents (P1)
- **Objectif** : tous les fronts joignent le bon backend sans blocage CORS.
- **Contenu** : (a) documenter la valeur `CORS_ORIGIN` réelle attendue (énumérer `app./pos./m./mobile.`+customer-app) dans `.env.production.example` + RUNBOOK ; (b) aligner le défaut prod de base URL des fronts sur le backend réellement servi (dépend du cutover DNS — cf. N7) ; (c) harmoniser `mobile/vercel.json` (rewrite mort) et remplir `customer-app/vercel.json` (SPA fallback).
- **Risque** : docs + config front (pas de Tier-2). La valeur runtime `CORS_ORIGIN` (Railway) reste **owner**.
- **Terminé quand** : matrice fronts→backend documentée, vercel.json cohérents.

## Bloc N4 — Throttler & doc infra honnêtes (P2)
- **Objectif** : la doc reflète la réalité, ou le throttler devient réellement partagé.
- **Options** : (1) brancher un `ThrottlerStorageRedis` quand `REDIS_URL` est set (rate-limit multi-pod réel) ; (2) a minima corriger `main.ts`/`.env.example` qui prétendent à tort « Redis ». Documenter `ALLOW_INMEMORY_CACHE`, corriger `CORS_ORIGIN` « NO »→« requis prod », harmoniser PORT/targetPort (`railway.toml`).
- **Risque** : faible. **Terminé quand** : doc = code ; option 1 testée si retenue.

## Bloc N5 — Offline sync : durcir origine & conflits (P2)
- **Objectif** : lever les deux stubs assumés.
- **Fichiers** : `syncEngine.ts`/`hmacSecurity.ts` — soit câbler réellement `signSyncRequest` (header + vérif serveur), soit retirer le stub et documenter « JWT-only » ; implémenter `checkForConflicts` (version serveur) ou assumer explicitement la stratégie ticket-priority.
- **Risque** : moyen (touche la sync). Réversible, testable. **Terminé quand** : décision tranchée + test.

## Bloc N6 — Douchette wedge clavier (P2)
- **Objectif** : capter une douchette USB-HID globale.
- **Fichiers** : brancher `startBarcodeListener()` au montage POS (avec la garde « ignorer si focus input ») ou retirer le code mort si la stratégie reste « champ focalisé + caméra ».
- **Risque** : faible. **Terminé quand** : scan douchette hors champ fonctionne, ou code mort retiré.

## Bloc N7 — ⚠️ Cutover DNS (P1, déjà outillé)
- **Objectif** : `api.addxintelligence.com` → caisse-backend.
- **État** : workflow prêt, verify vert (a)-(d), **bloqué (e) sur `IONOS_API_KEY` (format invalide)**. **Owner corrige la clé** ; ensuite relancer verify puis migrate (gaté Environment). **Tier-2 — GO + approbation GitHub.** Réécrire `DNS-CUTOVER-CHECKLIST.md` (Cloudflare/service-mort = faux).
- **Terminé quand** : verify vert intégral, migrate approuvé, domaine basculé + smoke.

## Bloc N8 — ⚠️ Refund carte Stripe (P1, décision produit)
- **Objectif** : rembourser réellement une carte lors d'un retour, ou assumer le manuel.
- **Options** : (1) `refunds.create` depuis `createReturn` (**paiement réel = Tier-2, GO**) ; (2) statu quo + écran « remboursements carte à exécuter » listant les avoirs `refundMethod:card`. Recommandation court terme : (2).
- **Terminé quand** : option tranchée ; si (1), test refund + rollback.

## Bloc N9 — PI Stripe orphelins (P1)
- **Objectif** : détecter un PI capturé sans vente.
- **Contenu** : soit webhook `payment_intent.succeeded` côté caisse, soit job de réconciliation périodique (PI capturés vs `sale_payments.stripePaymentIntentId`) → alerte manager. **Tier-2 si touche capture réelle → GO.**
- **Terminé quand** : orphelins remontés, jamais d'argent silencieux.

## Blocs de décision (pas de code avant arbitrage owner)

| Décision | Options |
|---|---|
| D-I Comptamax24 | définir le contrat d'export (CSV FEC / journal / event stream) — tout est à construire ; `connected-apps` est une coquille réutilisable |
| D-II Doctrine employés TW24 | soit implémenter l'import TW24→`employees` (source de vérité réelle), soit assumer local-first et corriger la doc |
| D-III Météo | retirer définitivement (N2) ou réintroduire un proxy |
| D-IV Notifications SMS/push | brancher un provider (Twilio/…) ou retirer le « future » |
| D-V TW24 HMAC | rendre HMAC obligatoire en prod (échouer si KEY_ID vide) ou documenter le repli Bearer |

## Ordre recommandé
1. **N1⚠️** (risque prod magasins) — le plus urgent.
2. **N2 + N3 + N4** (404 POS, CORS/URL, doc honnête) — non-Tier-2, rapides.
3. **N7⚠️** dès clé IONOS corrigée (déjà en cours).
4. **N5 + N6** (sync/douchette).
5. **N8⚠️ + N9** (refund/PI orphelins) sur décision.
6. Décisions D-I…D-V au fil de l'eau.
