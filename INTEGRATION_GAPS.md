# INTEGRATION_GAPS — Trous, casses et incohérences des connexions

> Audit 2026-07-10, `main` @ `6238350`. Classement : P0 bloquant / P1 risque données ou prod / P2 incomplet / P3 amélioration.
> Complément de `INTEGRATION_MATRIX.md` et `API_CONNECTION_MAP.md`. Aucune correction (phase constats).

## 🔴 CASSÉ

| # | Connexion | Blocage | Conséquence | Preuve | Prio |
|---|---|---|---|---|---|
| I1 | TW24 store sync destructif | `syncFromTimeWin` désactive tous les magasins locaux absents de la liste TW24, sans garde-fou « refuser si 0 » | Une réponse TW24 `200 {stores:[]}` (mauvais tenant/clé au périmètre vide) **éteint tout le réseau magasins** | `stores.service.ts:390-399` (contre-vérifié) | **P1** |
| I2 | POS → `/api/weather/*` | Aucun `@Controller('weather')` | 404 à chaque démarrage POS (`weatherApi.get` dans `usePOSLifecycle.ts:101`) | grep négatif (contre-vérifié) | P2 |
| I3 | POS → `/api/occupancy/:storeId/weather` | Route supprimée (migrée TW24) mais toujours appelée | 404 (`POSPage.tsx:403`) | `occupancy.controller.ts:74` | P2 |
| I4 | Backoffice create/update produit | Payload ≠ DTO (P0 audit produits) | 400 systématique | `ProductsPage.tsx` (avant R1) | **P0 — corrigé par PR #46 (R1)** |
| I5 | Throttler « Redis/multi-instance » | `forRoot` sans `storage` → mémoire | Rate-limit non partagé entre pods ; promesse `main.ts`/`.env.example` fausse | `app.module.ts:90` (contre-vérifié) | P2 |
| I6 | Douchette wedge clavier | `startBarcodeListener` jamais appelé | Douchette USB-HID globale non captée en caisse | `peripheralBridge.ts:462-501` | P2 |

## 🟠 PARTIEL (risque réel)

| # | Connexion | Ce qui marche | Ce qui manque | Impact | Prio |
|---|---|---|---|---|---|
| I7 | Base URL fronts prod | backoffice same-origin OK | POS/mobile/customer-app en absolu → défaut `api.addxintelligence.com` = CNAME **encore non basculé** | tant que le cutover DNS n'est pas fait, un front en défaut prod tape l'ancien backend | **P1** |
| I8 | CORS | fail-fast prod si absent/`*` | valeur runtime hors repo ; doit énumérer `pos./m./mobile.`+customer-app | un sous-domaine oublié = préflight bloqué pour ce front | **P1** |
| I9 | Refund carte → Stripe | avoir + journal corrects | aucun `refunds.create` (enregistrement seul) | remboursement carte manuel sur dashboard Stripe — risque d'oubli, écart compta/Stripe | **P1** |
| I10 | PI Stripe orphelin | vente refusée si PI invalide | pas de webhook `payment_intent.*` côté caisse ni balayage serveur | PI capturé + crash avant `sales.create` = argent sans ticket jusqu'à intervention | P1 |
| I11 | Offline sync HMAC device | JWT employé authentifie | `signSyncRequest` jamais posé en header (stub) | pas de preuve d'origine device sur les pushes offline | P2 |
| I12 | Offline sync conflits | file + idempotency OK | `checkForConflicts` = stub `{hasConflict:false}` | conflits de version serveur non détectés (résolution « ticket priority » jamais déclenchée) | P2 |
| I13 | TW24 auth doctrine | login local-first testé | « TW24 source de vérité employés » contredit : pas d'import TW24→`employees`, `posPinHash=''` | doctrine incohérente entre modules et docs | P2 |
| I14 | TW24 HMAC vs Bearer | HMAC si secret+keyId | `TIMEWIN24_POS_KEY_ID` vide en prod ⇒ **repli silencieux sur Bearer** malgré secret présent | intention HMAC non tenue sans erreur | P2 |
| I15 | TW24 `total:0` | renvoyé au client | ne distingue pas 502 (auth manquante, magasins intacts) de 200 liste vide (magasins éteints — cf. I1) | diagnostic « 0 stores » ambigu | P2 |
| I16 | connected-apps | CRUD + masquage apiKey | aucun moteur d'émission, aucun OAuth, aucun consommateur | registre descriptif sans effet | P2 |
| I17 | Airtable ops | intégration réelle, garde-fous risque | `AIRTABLE_ENABLED=false` par défaut, produits/stock only | dormant tant qu'aucune clé fournie (par design) | P3 |
| I18 | Timeout 15 s uniforme | OK requêtes normales | exports CSV/PDF/reports lourds > 15 s échouent | opérations longues coupées | P3 |
| I19 | Env incohérentes | boot validé | `ALLOW_INMEMORY_CACHE` non documenté ; `CORS_ORIGIN` doc « NO » vs code « requis prod » ; PORT `EXPOSE 3001` en dur vs 8080 Railway, `railway.toml` sans targetPort/healthcheckPath | pièges de config prod | P2 |
| I20 | Notifications SMS/push | calcul des rappels | envoi = `logger.log` (« future: SMS/email API ») | rappels fidélité/stock jamais envoyés | P3 |
| I21 | mobile/customer-app hébergement | routing app | `mobile/vercel.json` rewrite mort (baseURL absolue) ; `customer-app/vercel.json` vide (pas de SPA fallback) | incohérences de déploiement front | P3 |

## ⚫ ABSENT / PRÉVU UNIQUEMENT

| Intégration | État | Conséquence |
|---|---|---|
| Comptamax24 | Zéro code (doctrine « SaaS séparé ») | aucun export comptable (ni endpoint, ni event, ni CSV FEC/journal) — tout à construire |
| Analytik R / Pay24 Max | Zéro code | mentionnés uniquement pour constater leur absence |
| Webhook Stripe côté caisse (`payment_intent.*`) | absent | pas de réconciliation asynchrone des captures |
| Refund carte Stripe | absent | cf. I9 |
| Import employés TW24 → DB locale | absent (cache mémoire only) | doctrine « source de vérité » non implémentée |
| Payroll TW24 / getEmployeeContext / getStoreConfig | exposés, 0 consommateur | surface API dormante |
| Pointage TW24 (clock-in/out) | API branchée, caisse utilise pointage local | pointage TW24 non utilisé par le POS |
| Tiroir-caisse desktop (kick USB/RJ11) | absent (honnête `return false`) | kick seulement en Bluetooth iPad |
| Signature .exe / auto-update desktop | absent | SmartScreen ; distribution manuelle |
| Envoi SMS notifications | absent (log-only) | cf. I20 |

## 🔴 Documentation fausse (à corriger)

| Doc | Erreur | Réalité |
|---|---|---|
| `packages/backend/DNS-CUTOVER-CHECKLIST.md` | parle de **Cloudflare** et d'un ancien service **« mort 404 »** | provider = **IONOS** ; ancien service `bgzfcn8a`/sweet-blessing **vivant** (le rollback y re-rattache le domaine et vérifie `redis=up`) |
| `main.ts` / `.env.example` | « rate-limit partagé via Redis » | throttler en mémoire (I5) |
| `CLAUDE.md:315` | `CORS_ORIGIN` « NO » (optionnel) | requis en prod (`main.ts:189-198`) |
| CLAUDE.md vs RUNBOOK | workspace `y5ctnxgdc9-hue` vs `vibrant-freedom` | à harmoniser |

## Ce qui est SOLIDE (ne bloque rien)

Backoffice same-origin ; PostgreSQL (pool, migrations auto, 503 si down) ; capture carte vérifiée serveur (9 specs) ; WisePad 3 réel (sim gated) ; webhook billing signé ; séparation d'audience staff/mobile ; refresh interceptor robuste (3 clients) ; customer-app 100 % routes matchées + stockage natif ; IPC desktop printing/customer-display complet et honnête ; idempotency sync ; ping santé réseau ; cache & realtime Redis avec fallback ; Airtable ops (gardes de risque).
