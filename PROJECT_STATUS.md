# PROJECT_STATUS.md — État réel du projet POS Caisse The Wesley

> Généré par audit read-only le **2026-06-28**, enrichi au fil des paquets.
> Règle d'honnêteté : rien n'est déclaré "fait/testé/branché" sans preuve. Voir `EXECUTION_LOG.md`.

## 0. Bilan session 2026-06-28 (paquets 1→28, blocs jusqu'à #61)

**Vérifié dans le sandbox** : **223 tests PASS** sur 33 suites (helpers purs + DTO + services à repo mocké), `tsc --noEmit` **EXIT 0** à chaque paquet.
- Lot A (helpers purs) 13 suites / 106 · Lot B (helpers+DTO) 13 / 60 · Lot C (services mockés) 7 / 57.

**Livré & branché (prouvé tests + tsc)** : POS-054 remises (caisse 30% strict + justif 21-30% + back-office 100% admin), POS-083 alerte stock 20% baseline, POS-066 dédup nom normalisé, POS-061 override prix magasin, POS-073 anti-cumul + plafond usage (exclusion), POS-018/018b historique+DTO validé, POS-132 anti-XSS, POS-085 inventaire/écart, POS-122 Z-report, POS-094 ventes/employé (endpoint), POS-100 export compta local (CSV), POS-102 rapprochement paiements, TimeWin24 HMAC+mapping. **Bug corrigé** : `store_credit` rejeté à la validation (avoirs).

**Migrations réversibles ajoutées** : 1721 (stock baseline), 1722 (normalized_name), 1723 (price override), 1724 (promo usage). **NON exécutées dans le sandbox** → `npm run migration:run` en local.

**Modules créés** : `backoffice-discounts`, `mobile-cockpit` (42 modules).

**Limites honnêtes** : suites lourdes (sale-transaction/fiscal/pg-mem) non exécutables ici (cap 45 s) → à confirmer vertes en local ; runtime DB des nouveaux endpoints à valider local ; **Paywin24 / Comptamax24 (envoi) non branchés** ; connectivité TimeWin24 live non testée.

**Git** : ref bloquée (mount FUSE — `index.lock`/`HEAD.lock` non supprimables). Tout le travail est sur disque + objet commit `4ff20b3` (dangling, paquets 2→28) + `_BACKUP_PAQUET_2-28.patch`. Récupération : `GIT_RECOVERY.md`.

**Gates / décisions ouvertes** : `TD-STOCK-TWO-SYSTEMS` (unification stock), `TD-073-USAGE-INCREMENT`, `TD-COMPTAMAX`/Paywin24, `TD-055-QUIET-HOURS-WIRING`.

## 1. Méthode

Audit → Plan → Exécution par paquets de 5 blocs. Référentiel des blocs : `POS_BLOCKS.md`.

## 2. Faits vérifiés (preuves par commandes read-only)

| Élément | Valeur réelle vérifiée | Source documentée (CLAUDE.md) | Écart |
|---|---|---|---|
| Packages | 5 (`backend`, `backoffice-web`, `customer-app`, `mobile`, `pos-desktop`) + `shared/` | 5 + shared | OK |
| Modules backend | **40** | 37 | ⚠️ doc périmée |
| Entités TypeORM | **47** | 45 | ⚠️ doc périmée |
| Migrations | **16** (jusqu'à `1720000000000-AddSaleSeqCursor`) | 11 | ⚠️ doc périmée |
| Controllers backend | **37** | n/c | — |
| Décorateurs de routes | **213** | n/c | — |
| Fichiers de specs backend | **66** (`*.spec.ts`) | 49 | ⚠️ doc périmée |
| Cas de test (approx `it(`/`test(`) | **~488** | "405 tests" | ⚠️ doc périmée |
| Branche git courante | `fix/ticket-number-sequence-cursor` | — | — |

### Modules non documentés dans CLAUDE.md (présents dans le code)
`documents`, `fiscal`, `pos-session`.

## 3. Exécution réelle des tests (honnête)

- Le module natif `bcrypt` de `node_modules` était compilé pour macOS → échec `invalid ELF header` dans le sandbox Linux. **Rebuild Linux effectué** (`npm rebuild bcrypt`, réversible, node_modules uniquement).
- Sous-ensemble vérifié : suite "money" → **9/9 PASS**. Les suites diffusées montraient PASS sans FAIL avant coupure.
- ⚠️ **La suite complète (~488 cas) n'a PAS pu être confirmée verte dans ce sandbox** : la limite de 45 s/commande + le coût de compilation `ts-jest` empêchent une exécution complète en une fenêtre. À confirmer sur une machine sans cette limite (`npm run test:backend`).
- Tests front / e2e Playwright / build desktop : **non lancés** dans ce sandbox.

## 4. Intégrations — état réel

| Intégration | État vérifié |
|---|---|
| TimeWin24 | Service présent (`modules/timewin/timewin.service.ts`). Connectivité réelle **non testée** ici. AUDIT-FINAL-2026-04 signalait circuit breaker OPEN — à re-vérifier. |
| Stripe Terminal | Service backend + hooks POS présents. Paiement réel **non testé** (interdit en audit). |
| Paywin24 (paie) | **Aucune référence dans le code** → futur / non branché. |
| Comptamax24 (compta) | **Aucune référence dans le code** → futur / non branché. |
| Cockpit mobile `GET /api/mobile/v1/alerts` | **Créé** (PAQUET 9) : module `mobile-cockpit`, read-only, manager/admin, agrège stock + anomalies. Shaper testé 6/6, tsc clean. Runtime DB à valider en local. |
| ESC/POS | Côté POS uniquement (`useBluetoothPrinter`). Pas de backend (normal). |

## 5. Risques ouverts hérités (à re-vérifier — issus de AUDIT-FINAL-2026-04-01)

Ces points datent d'avril 2026 ; plusieurs commits fiscaux/correctifs ont suivi. **Statuts re-vérifiés aux paquets 241-243 :**

1. PIN login 500 en prod (auth.service) — ⏳ À VÉRIFIER en runtime local (non reproductible sans DB/prod ici). Auth JWT couvert par tests (auth-security, mobile-tokens).
2. Clés API réelles dans `docker/.env.production.example` — ✅ VÉRIFIÉ PROPRE (scan `findSecretLeaks` P236) ; garde testé sur TOUS les `.env*` suivis empêche toute réintroduction.
3. Erreurs avalées côté front (`StockAlertsPage`, `LabelsPage`) — ✅ PÉRIMÉ : les deux pages surfacent leurs erreurs (audit P242) ; StockAlertsPage durci via `safeErrorMessage`.
4. XSS receipts HTML (échappement) — ✅ MITIGÉ + TESTÉ : `escapeHtml` (POS-132) câblé sur tous les champs texte ; verrou e2e anti-`<script>` (P241).
5. Receipts publics sans auth — ✅ INTENTIONNEL : `saleId` = UUID → capability-URL non énumérable (modèle Stripe) ; email protégé JwtAuthGuard (P241).
6. Boutons morts (exports) — ✅ traité : hygiène front (P181/182/196) a supprimé le code mort ; exports CSV branchés (Comptabilité/Supervision/Inventaire). À re-vérifier ponctuellement.

## 6. Prochaine action

Voir `POS_BLOCKS.md` → premier paquet (PAQUET 1). Détail d'exécution dans `EXECUTION_LOG.md`.

---
## État consolidé — 2026-07-02 (jalon PAQUET 331, v33 — cycles L/M/N : UI variantes complète + consolidation qualité)

- **L/P329 — sélecteur fournisseur livré** : liste chargée via `suppliersApi`, option « — Aucun — » = clear par null explicite (builder déjà testé), `supplierId`/`parentProductId` exposés dans le mapping produits. La chaîne fournisseur est complète de la table au modal.
- **M/P330 — regroupement visuel des variantes** : helper pur `groupProductsForDisplay` (3 tests : variantes imbriquées sous leur parent triées par libellé, **orphelines jamais masquées** — on ne cache pas de stock à l'opérateur, ordre amont préservé) + UI (indentation, chips variante/compteur/orpheline, marque affichée). Read-only back-office — scan EAN/décrément/hash-chain/promos **intouchés**.
- **N/P331 — consolidation qualité** :
  - Backend COMPLET en 5 tranches : **209 suites PASS / 3 skip (.pg) · 1378 tests PASS / 5 skip · 0 échec** · `nest build` RC 0.
  - Fronts COMPLETS : back-office **9 fichiers/35 tests** · pos-desktop **8/37** · mobile **3/13** = **20 fichiers / 85 tests PASS** · builds verts.
  - Api-map régénérée (43 controllers / 236 routes) ; docs alignées (CLAUDE.md 45 modules/48 entités/24 migrations + module suppliers listé ; STATE_INDEX re-compté P331).
  - **File GATE 2 vérifiée intacte** : 1725/1726/1727 présentes, non jouées, CI ne lance jamais `migration:run` (0 occurrence), tout réversible (down() prouvés pg-mem). Preflight OVERALL PASS · anti-secret 34 PASS.

Commits : `9ada16e` L · `db1ed79` M · (v33 ci-dessous) N. Interdits respectés : zéro push, zéro prod, zéro secret, zéro migration runtime.

---
## État consolidé — 2026-07-02 (jalon PAQUET 328, v32 — cycle K : variantes option A EXÉCUTÉE)

- **GO variantes option A reçu → livré (P327)**, conformément à `PRODUCT_VARIANTS_DECISION.md` :
  - **Migration 1727** (additive/réversible, dry-run pg-mem 2 tests, rejoint la file GATE 2 avec 1725/1726) : `products` + `parent_product_id`/`variant_label`/`brand`/`supplier_id` (tous nullables — lignes existantes = produits simples) + table `suppliers` (tenant, nom unique par magasin) + index regroupement.
  - **Module `suppliers`** (45e module) : CRUD tenant-scoped, écriture manager+, **soft-delete** (les produits gardent leur référence — historique intact). 3 tests pg-mem : dédup par magasin, soft-delete, cross-tenant 404.
  - **Variantes prouvées sur SQL réel** : deux déclinaisons d'un même parent coexistent avec EAN/prix/stock propres ; regroupement par `parentProductId` ; **doublons interdits PAR variante** (l'unique `(ean, store)` existant fait le travail). ZÉRO invariant caisse touché (scan/vente/stock/hash inchangés).
  - **DTOs produits** étendus (4 champs nullables, clear par null explicite) ; **back-office** : champs Marque + Variante dans le modal produits, builder de payload étendu (+2 tests vitest), `suppliersApi` prêt.
  - Reste UI (itération suivante, non bloquant) : sélecteur de fournisseur dans le modal + regroupement visuel des variantes sous leur parent.
- MIGRATION_RUNBOOK + CLAUDE.md mis à jour (file GATE 2 = 1725→1726→1727, rollback 3 crans, garde-fou suppliers non-vide).
- **P328 consolidation** : backend COMPLET en 5 tranches — **209 suites PASS / 3 skip (.pg) · 1378 tests PASS / 5 skip · 0 échec** (Δ v31 : +2 suites, +5 tests). Back-office 8 fichiers/32 tests, builds verts, `nest build` RC 0. TD-PRODUCT-VARIANTS ✅ RÉSOLU.

Commit : `14fd263`. Interdits respectés : zéro push, zéro prod, zéro secret, zéro migration runtime.

---
## État consolidé — 2026-07-02 (jalon PAQUET 326, v31 — cycle J : écran clôture de caisse POS livré)

- **P325 — l'UI session POS existe désormais** (choix UX documentés, réversibles) :
  - `lib/terminal-id.ts` : identité terminal STABLE par appareil (localStorage, override admin possible « CAISSE-1 »), 3 tests.
  - `posSessionsApi.ensure` : find-or-open de la session γ du terminal, **best-effort** — hors-ligne/échec ⇒ mode sans-session, la caisse vend exactement comme avant (jamais bloquante).
  - **`CloseSessionModal`** : résumé de session (ventes, espèces, total), fond de caisse + comptage physique, **écart signé affiché** (exact/excédent/manquant) — jamais auto-corrigé, confirmation explicite en cas d'écart.
  - Câblage POSPage : session au montage/retour réseau, bouton « Clôture de caisse (comptage) », modal.
  - **FIX trou réel découvert au câblage** : le POS n'envoyait JAMAIS `X-Terminal-Id` → le stamp session P312 et POS-INT-83 étaient inertes en usage réel. L'intercepteur envoie désormais l'identité terminal sur TOUTES les requêtes POS (best-effort).
- **P326 consolidation** : backend COMPLET en 5 tranches — **207 suites PASS / 3 skip (.pg) · 1373 tests PASS / 5 skip · 0 échec** (inchangé v30 : le cycle J est front). Front pos-desktop : **8 fichiers / 37 tests** vitest, tsc EXIT 0, vite build vert.

Commit : `b7eb168`. Interdits respectés : zéro push, zéro prod, zéro secret, zéro migration runtime.

---
## État consolidé — 2026-07-02 (jalon PAQUET 324, v30 — cycle I : les gates transformées en livrables prêts-à-brancher)

- **I1/P318 — GATE 1 close côté préparation** : anti-rejeu prouvé e2e (receveur à horloge décalée refuse hors fenêtre 5 min, ligne retryable) — la chaîne loopback couvre désormais TOUT le contrat (HMAC, rejeu, retry, dead-letter, batch_id, dédup event_id — 6 tests). Ne manque que URL+secret réels (kit §7).
- **I2/P319 — GATE 2 prête** : `MIGRATION_RUNBOOK.md` (backup obligatoire, états avant/après, contrôles post, rollback avec garde-fou « ne pas revert 1725 si outbox non vide », gardes anti-accident, avertissement boot auto-migrant prod) + dry-run pg-mem 1726 (up idempotent, legacy NULL, down propre). Il ne manque que DATABASE_URL + ta commande.
- **I3/P320 — GATE 3 prête** : `SOCIAL_CHART_TEMPLATE.md` (formulaire comptable, 4 slots SANS codes pré-remplis, 4 questions à trancher, jour J + rollback fail-closed) + `npm run social:check` (validateur de structure réutilisant le vrai garde runtime — 5 tests). Zéro vérité métier inventée.
- **I4/P321 — Variantes cadrées** : `PRODUCT_VARIANTS_DECISION.md` — option A recommandée (variante=produit + parent_id/label/brand/supplier, ZÉRO impact caisse), B/C rejetées argumentées, impacts par couche, périmètre 1 cycle. Attend « GO variantes option A ».
- **I5/P322 — Front livré** : **écran Réconciliation Stock** back-office complet (page+route+nav, dérives triées en premier, badges, lecture seule, helpers testés) ; côté POS : `posSessionsApi` + `lib/cash-count` (écart signé exact/excédent/manquant, parsing strict) **prêts à brancher** — l'UI session POS n'existe pas encore (décision UX honnêtement documentée, mon « simple bascule » était sur-vendu pour cette moitié).
- **I6/P323 — Revue H** : H1/H2 aucun trou réel ; H3 : **trou UX corrigé** — pendant le verrou anti-bruteforce, message distinct « verrouillé, réessayez dans X min » (un PIN correct était refusé comme un invalide → re-essais aggravants).
- **P324 consolidation** : backend COMPLET en 5 tranches — **207 suites PASS / 3 skip (.pg) · 1373 tests PASS / 5 skip · 0 échec** (Δ v29 : +2 suites, +8 tests). Front : back-office 8 fichiers/30 tests · pos-desktop 7 fichiers/34 tests · builds verts.

Commits : `1517357` I1 · `59d0c08` I2 · `13a10a1` I3 · `94b0505` I4 · `fedd5d2` I5 · `af39ede` I6. Interdits respectés : zéro push, zéro prod, zéro secret, zéro migration runtime, zéro invention.

---
## État consolidé — 2026-07-02 (jalon PAQUET 317, v29 — cycle H : 3 derniers items sans-décision fermés)

- **H1/P314 — TD-AUDIT-HASH-DUP risque neutralisé** : `audit-hash-drift-guard.spec.ts` (8 cas adversariaux : clés désordonnées, imbrication, accents/emoji, null/bool/gros nombres, chaînage depuis genesis) échoue à la PREMIÈRE dérive entre `audit-hash.ts` (backend) et `shared/hash.ts`. L'unification physique reste une décision build (inchangé) — mais la dérive silencieuse est désormais impossible.
- **H2/P315 — TD-018-FILTERS-RUNTIME ✅ RÉSOLU** : filtres historique ventes prouvés sur SQL réel (4 tests pg-mem : tenant + tri DESC, employeeId, bornes from/to inclusives, status, combinaison AND).
- **H3/P316 — TD-RESP-PIN ✅ RÉSOLU** : anti-bruteforce du PIN responsable — `PinAttemptLimiter` par magasin (5 échecs consécutifs → verrou 15 min, **fail-closed sans comparaison bcrypt pendant le verrou**, succès = reset, horloge injectable ; 4 tests + non-régression sales 25 suites/161 tests + e2e 10/10). Limite honnête : in-memory (mono-instance, même posture que ALLOW_INMEMORY_CACHE).
- **P317 consolidation** : backend COMPLET en 5 tranches —
  **205 suites PASS / 3 skip (.pg) · 1365 tests PASS / 5 skip · 0 échec** (Δ v28 : +3 suites, +16 tests). `nest build` RC 0.
- **État du backlog : le stock d'items exécutables SANS décision utilisateur est épuisé.** Tout le reste attend une entrée : GATE 1 (URL+secret), GATE 2 (DATABASE_URL + GO — migrations 1725+1726 en file), GATE 3 (plan de comptes), variantes produit (modèle), TD-TAX-DUP (décision fiscale), unification physique du hash (décision build), backfill:names sur cible, écrans comptage/stock-locations (souhait produit).

Commits : `fedda4b` H1+H2 · `8c7c2e4` H3 · `fdcd387` docs. Interdits respectés : zéro push, zéro prod, zéro secret, zéro migration runtime.

---
## État consolidé — 2026-07-02 (jalon PAQUET 313, v28 — cycle G : TD-017-SESSION-LINK RÉSOLU, comptage session débloqué)

- **G1/P312 — lien vente↔session POS** : migration **1726-AddSalePosSessionId** (colonne uuid nullable + index composite ; additive/réversible ; ⚠️ NON jouée sur la base cible — même gate que 1725/GATE 2) + `sale.posSessionId` (hors empreinte fiscale, lien de métadonnée) + **stamp best-effort dans createSale** : session active du (store, terminal) résolue pré-transaction, échec ou absence de session ⇒ NULL, **jamais** une vente bloquée.
- **G2/P312 — `GET /api/pos-sessions/:id/cash-summary`** : agrégat de comptage (POS-017b débloqué) — ventes complétées stampées de la session : `salesCount`, `cashCapturedMinorUnits`, `totalCapturedMinorUnits`. Limite honnête : les ventes antérieures au lien (NULL) sont exclues par construction.
- Preuve e2e (money-flow **10/10**) : vente sur terminal avec session ouverte → stampée avec le bon id ; vente sans terminal → NULL ; résumé cash exact (1 vente, 500, 500). Mocks unitaires adaptés (DataSource dans pos-session.spec) ; api-map régénérée (232 routes).
- `TECHNICAL_DEBT.md` : **TD-017-SESSION-LINK ✅ RÉSOLU P312**. CLAUDE.md : migration 1726 listée (gate cible).
- **P313 consolidation** : backend COMPLET en 5 tranches —
  **202 suites PASS / 3 skip (.pg) · 1349 tests PASS / 5 skip · 0 échec** (Δ v27 : +1 test e2e). `tsc` EXIT 0 · `nest build` RC 0.

Commit : `353080f`. Interdits respectés : zéro push, zéro prod, zéro secret, zéro migration runtime (1726 = fichier versionné, exécution cible gated).

---
## État consolidé — 2026-07-02 (jalon PAQUET 311, v27 — cycle F : réconciliation stock + 2 dettes fermées + bug contrat produits corrigé)

- **F1/P308 — `GET /api/stock/reconcile`** (admin/manager, read-only) : réconciliation par produit compteur A vs net journal (P306+, honnête : variation, pas stock absolu sans backfill) vs balance legacy B, avec `balanceDrift` + `driftCount`. 3 tests pg-mem (drift détecté, magasin sans location, tenant). Api-map régénérée (231 routes).
- **F2/P309 — TD-066-LEGACY-BACKFILL ✅ RÉSOLU** : script one-off `npm run backfill:names` (dry-run par défaut, `BACKFILL_APPLY=true` pour appliquer, chunked, idempotent) ; **collisions même-magasin quarantainées** pour arbitrage humain (jamais de fusion silencieuse). 2 tests pg-mem (plan accent-folded + apply idempotent). Exécution cible = gated DATABASE_URL+GO.
- **F3/P310 — TD-061-UI livré + BUG CONTRAT CORRIGÉ** : le payload produits du back-office envoyait `price/stock/category/storeId` — tous **rejetés en 400** par `forbidNonWhitelisted` (l'édition produit était cassée contre ce backend). → builder pur `buildProductPayload` (clés DTO uniquement, euros→centimes, `categoryId` seulement si uuid) + **champ override prix magasin** en édition (vide = prix global, null explicite pour effacer) + DTO `priceOverrideMinorUnits` nullable (Update uniquement). 4 tests vitest ; tsc+vite builds verts.
- Bonus P311 : la garde env-completeness a attrapé `BACKFILL_APPLY` non documentée → ajoutée à `.env.example` (la garde fonctionne).
- **P311 consolidation** : backend COMPLET en 5 tranches —
  **202 suites PASS / 3 skip (.pg) · 1348 tests PASS / 5 skip · 0 échec** (Δ v26 : +2 suites, +5 tests). Back-office vitest **7 fichiers / 27 tests** ; `nest build` RC 0 ; tsc EXIT 0 partout.

Commits : `0808f29` F1 · `e9d6688` F2 · `8866337` F3. Interdits respectés : zéro push, zéro prod, zéro secret, zéro migration runtime.

---
## État consolidé — 2026-07-02 (jalon PAQUET 307, v26 — cycle E : GO option 1 exécuté, TD-STOCK-TWO-SYSTEMS RÉSOLU)

- **GO utilisateur reçu** sur l'option 1 du dossier `STOCK_UNIFICATION_DECISION.md` → exécutée intégralement (P306) :
  - `stock/stock-movement-journal.ts` : fonctions pures sur EntityManager — `ensureStoreLocation` (mapping magasin→location **paresseux et idempotent**, code stable `ST-…`), `recordSaleMovements` (POS-081, from=magasin→null), `recordReturnMovements` (POS-082, null→magasin), `recordAdjustMovement` (delta signé, 0 = rien), `journalNetQuantities` (**projection reconstruite** = sous-choix retenu ; aucune écriture `stock_balance` depuis la caisse).
  - **5 chemins d'écriture stock câblés, MÊME transaction que le fait métier** : `createSale`, `createReturn`, `stock.adjustStock`, `inventory-scan.applyScansToStock`, `sync.push` (offline, émis seulement si la ligne du bon magasin est réellement touchée). Le journal ne peut plus diverger d'un fait commis ; `products.stock_quantity` reste LE compteur opérationnel (zéro impact caisse, réversible en cessant d'émettre).
  - Preuves : `stock-movement-journal.pgmem.spec.ts` (4 tests — lazy/idempotent, directions par type, projection nette Σin−Σout, items invalides ignorés) + **assertion e2e** (vente et retour réels écrivent leurs mouvements ; une seule location auto-créée) ; mocks des suites unitaires adaptés (insert/create/save 1-arg).
  - `TECHNICAL_DEBT.md` : **TD-STOCK-TWO-SYSTEMS ✅ RÉSOLU P306** ; dossier §6 « EXÉCUTÉ ».
- **P307 consolidation** : backend COMPLET en 5 tranches —
  **200 suites PASS / 3 skip (.pg) · 1343 tests PASS / 5 skip · 0 échec** (Δ v25 : +1 suite, +5 tests). `tsc` EXIT 0 · `nest build` RC 0.
- Reste (documenté, non bloquant) : backfill historique du journal = optionnel non requis ; écrans stock-locations lisent encore `stock_balance` incrémentale (la projection `journalNetQuantities` est disponible pour les basculer — paquet futur si souhaité).

Commit : `342547f` (E1-E3). Interdits respectés : zéro push, zéro prod, zéro secret, zéro migration runtime (le journal utilise les tables EXISTANTES de la migration 1713).

---
## État consolidé — 2026-07-02 (jalon PAQUET 305, v25 — cycle D : inventaire/retours SQL réel + bug front remise corrigé + arbitrage stock)

- **D1/P301 — inventory-scan pg-mem (6 tests)** : rejeu idempotent `clientEntryId` (même ligne, zéro doublon), lookup code-barres tenant-scoped (EAN du magasin voisin = `new`), apply atomique (inventory=recomptage ABSOLU, receiving=DELTA, re-apply no-op), store sans code refusé, stats session.
- **D2/P302 — returns read-paths pg-mem (4 tests)** : isolation tenant des avoirs (findOne/lookup cross-store = 404), règles spendable réelles (refund/épuisé non dépensables), SQL groupé des quantités retournées (notes `cancelled` exclues), returnable = vendu−retourné, pagination DESC.
- **D3/P303 — BUG FRONT CORRIGÉ (DiscountModal)** : le modal n'exigeait le PIN responsable qu'au-dessus de 20 % alors que le serveur l'exige **dès >0 %** → une remise de 10 % passait le modal puis était rejetée au paiement. Aligné (PIN dès >0 %, motif dès 21 % = seuils serveur), validation extraite en helper pur `discount-entry-policy` + **8 tests vitest** (bornes 30/30.01, 20/21, PIN, dépassement sous-total, parsing virgule). vite build vert.
- **D4/P304 — arbitrage TD-STOCK-TWO-SYSTEMS** : `STOCK_UNIFICATION_DECISION.md` (2 systèmes prouvés A compteur / B journal, divergence démontrée, 3 options, **option 1 recommandée** : journal dérivé append-only alimenté par vente/retour/ajustement — GO requis, rien exécuté). Commentaire mensonger de `stock-movement.entity.ts` corrigé (« auto-created by SalesService » = faux). TD-GIT-DANGLING marqué résolu (P272).
- **P305 consolidation** : backend COMPLET en 5 tranches —
  **199 suites PASS / 3 skip (.pg) · 1338 tests PASS / 5 skip · 0 échec** (Δ v24 : +2 suites, +10 tests). Front : **15 fichiers / 67 tests PASS** (back-office 23, pos-desktop 31, mobile 13). `tsc` EXIT 0 back+pos · vite build pos vert.

Commits : `a36bf1c` D1 · `4b599c5` D2 · `c1205be` D3 · `7e5ae9a` D4. Interdits respectés : zéro push, zéro prod, zéro secret, zéro migration runtime.

---
## État consolidé — 2026-07-02 (jalon PAQUET 300, v24 — cycle C : bug money-path TD-073 corrigé + catalogue durci)

- **C1/P297 — TD-073-USAGE-INCREMENT ✅ RÉSOLU (vrai bug)** : le plafond d'usage des promos ne décomptait JAMAIS (`usage_count` incrémenté nulle part → promo « limitée » en réalité illimitée). Fix : UPDATE atomique dans la transaction de vente (1 usage/promo/vente, ids distincts, tenant-scoped). Preuve e2e : cap 1 → vente 1 remisée + count 0→1, vente 2 plein tarif + count reste 1 (money-flow 8/8). + durcissement `isPromoApplicable` : normalisation jsonb string (une promo aux ids sérialisés en string était silencieusement désactivée).
- **C2/P298 — products pg-mem (6 tests)** : dédup nom normalisé par magasin (accents/casse) + index UNIQUE `(ean, store_id)` prouvé en dernier rempart (bypass service → refus DB) + rename resynchronise `normalized_name` (ancien nom libéré, nouveau réservé) + price-history/audit sur changement de prix (rien sur no-op) + findAll tenant/actifs/ILIKE.
- **C3/P299 — CI anti-pourrissement API map** : la CI régénère `POS_API_MAP_DETAILED.md` et échoue sur diff (générateur rendu byte-déterministe). La carto ne peut plus diverger des controllers.
- **P300 consolidation** : suite backend COMPLÈTE en 5 tranches —
  **197 suites PASS / 3 skip (.pg) · 1328 tests PASS / 5 skip · 0 échec** (Δ v23 : +1 suite, +7 tests). `tsc` EXIT 0.

Commits : `8b56ebd` C1 · `ee9072b` C2 · `3b2cd1e` C3. Interdits respectés : zéro push, zéro prod, zéro secret, zéro migration runtime.

---
## État consolidé — 2026-07-02 (jalon PAQUET 296, v23 — blocs B1→B8 : GATE 1 prouvée loopback + dettes résolues)

- **B1/P288 — GATE 1 répétée sans secret réel** : `relay-e2e-loopback.pgmem.spec.ts` (5 tests) prouve la CHAÎNE COMPLÈTE relay réel → `HttpOutboxPublisher` (vrai POST) → receveur HTTP réel (vérif HMAC) → statuts DB : publication+batch id, jamais de re-envoi, mauvais secret → 401 + ligne retryable, dead-letter à 5, re-livraison dédupliquée par event id. + `scripts/mock-receiver.js` (receveur contractuel exécutable : /received, /fail-next) + kit §6-7 (fourniture exacte GATE 1).
- **B2/P289 — TD-API-MAP ✅ RÉSOLU** : `POS_API_MAP_DETAILED.md` généré du code (42 controllers/**230/230 routes** : verbe, route, handler, guards, rôles, tenant, DTO) via `npm run api:map` (générateur tolérant décorateurs imbriqués + commentaires, vérifié par comptage croisé).
- **B3/P290 — Pricing 5 règles** : ①variantes **ABSENTES** → TD-PRODUCT-VARIANTS (gate décision produit) ; ②prix/magasin → wiring PROUVÉ en vente réelle e2e (override 750 facturé vs 1000 global, +1 test) ; ③doublons ✅ (EAN unique/magasin + name-dedup) ; ④responsable obligatoire ✅ ; ⑤cap 30 % ✅ (33 tests).
- **B4/P291 — Stock 20 %** : règle baseline LIVE vérifiée (1721 + effectiveAlertThreshold câblé décrément+SQL, preuve P278) ; chaîne humaine complète (alerte → cockpit read-only → ajustement avec motif → audit) ; **2 commentaires périmés dangereux corrigés** dans stock-level.ts (affirmaient la règle non branchée).
- **B5/P292 — Sécurité caisse + TD-055 ✅ RÉSOLU** : void-cash/sessions-terminal/auth-local-first/responsable déjà couverts ; quiet hours/fériés **câblés** dans le sweep shift-reminders (pure config env, fenêtre vide par défaut = zéro changement, 4 tests dont « sweep supprimé n'appelle pas TW24 ») + 3 vars documentées .env.example.
- **B6/P293 — Monitoring pré-prod** : MONITORING-PLAYBOOK §8 (5 moniteurs UptimeRobot prêts à coller avec keywords ok/degraded, activation AlertService/Sentry par variable, matrice healthchecks, revue logs hebdo avec signaux outbox/breaker/bruteforce). Zéro connexion réelle.
- **B7/P294 — `SERVER_SETUP_RUNBOOK.md`** : mise en service serveur de zéro pour humain (provision→docker→bundle→.env→preflight→deploy→smoke→SSL→backup cron→rollback→erreurs fréquentes).
- **B8/P295 — `RESUME_CHECKLIST.md` réécrit** : point d'entrée unique (état réel, gates+kits, interdits durs, commandes, 6 décisions business, dépannage).
- **P296 consolidation** : suite backend COMPLÈTE en 5 tranches —
  **196 suites PASS / 3 skip (.pg) · 1321 tests PASS / 5 skip · 0 échec** (Δ v22 : +1 suite, +10 tests actifs). `tsc` EXIT 0 · preflight PASS · anti-secret 34 PASS. Front inchangé depuis la preuve v22 (14 fichiers/59 tests).

Commits : `f8ac011` B1 · `7557e5f` B2 · `3201f84` B3 · `7f0f04d` B4 · `4b12fcd` B5 · `e4771a0` B6 · `601a7e5` B7 · `a551822` B8. Interdits respectés : zéro push, zéro prod, zéro secret, zéro migration runtime, zéro Timescale.

---
## État consolidé — 2026-07-02 (jalon PAQUET 287, v22 — blocs A1→A6 : contrats d'intégration + ops durcis)

- **A1/P282** MASTER_ROADMAP réécrit sur preuves (M0-M9 re-statués, chemin critique = gates). Écarts demande↔dépôt actés : pas d'`ops/` (réels : `scripts/preflight.sh`, `docker/deploy.sh`) ; pas de tables `tickets`/`register_events` (réelles : `sales`, `integration_events`) ; zéro référence Timescale préexistante.
- **A2/P282** Cohérence code↔docs : compteurs re-vérifiés (44 modules · 42 controllers · 230 routes · 21 migrations · 197 specs) ; `fiscal` = CLI-only volontaire ; `documents` câblé via receipts ; STATE_INDEX + POS_API_MAP corrigés.
- **A3/P283** **POS_PUSH_CONTRACT.md** (v1) : enveloppe (event_id/ticket_id→aggregateId/store_id/terminal_id/ts→occurredAt), auth HMAC-SHA256 + anti-rejeu 5 min, retry 5×/backoff/dead-letter, idempotence par event id, catalogue 11 types (Z-report = `cash_session.closed`), alternative pull keyset. Code additif : `x-pos-batch-id` (corrélation run de relais, jamais clé d'idempotence). **`wire-contract.spec.ts` gèle le contrat** (5 tests). Intégration 14 suites/102 tests PASS.
- **A4/P284** **TIMEWIN24_CONTRACT.md** : autorité (TW24 alerte, ne bloque JAMAIS la caisse), flux sortants webhook HMAC 9 types + clock-in/out, entrants (sync employés/planning/paie), anomalies présence 4 types → cockpit read-only, circuit breaker prouvé. **Fix CLAUDE.md : auth = LOCAL-first** (le doc disait TW24-first, le code est local-first, `POS_AUTH_AUTHORITY=timewin` = legacy).
- **A5/P285** Ops durcis (fichiers seulement, zéro action prod) : `docker/deploy.sh` gated (preflight → confirmation tapée → backup pré-déploiement → attente healthcheck réelle 120 s → smoke in-container [port 3001 non exposé à l'hôte] → hints rollback) ; **`docker/backup.sh` nouveau** (dump+intégrité+rétention 14, list/restore confirmé) ; RUNBOOK complété. `scripts/preflight.sh` relancé : OVERALL PASS.
- **A6/P286** **TIMESCALE_PLAN.md** (préparation seule) : piège PK mono-colonne↔`ts` transposé aux vraies tables ; règle dure « ledger NF525 jamais hypertable » ; option A recommandée (Postgres+BRIN+MV+purge), option B (table `analytics_events` dérivée, dédup AVANT insertion), option C rejetée ; Neon sans extension timescaledb noté ; critères de GO.
- **Bloc 7 (refactors)** : aucun refactor exécuté — aucune preuve de problème ne le justifiait (règle : pas de travail inventé).
- **P287** consolidation : suite backend COMPLÈTE rejouée en 5 tranches —
  **195 suites PASS / 3 skip (.pg) · 1311 tests PASS / 5 skip · 0 échec** (Δ v21 : +1 suite wire-contract, +5 tests). `nest build` RC 0 · preflight PASS · anti-secret 34 PASS.

Commits : `3305c63` A1 · `4e13b6a` A2 · `a768834` A3 · `0bad4bb` A4 · `2943755` A5 · `f999f6f` A6. Interdits respectés : zéro push, zéro prod, zéro secret, zéro migration runtime.

---
## État consolidé — 2026-07-02 (jalon PAQUET 281, v21 — cycle 3 Fab 5 : pg-mem chemins critiques stock/coupon/sync)

- **P278** `stock.service.pgmem.spec` (6) — décrément atomique tenant-scoped + outbox, adjustStock transactionnel (absolute/delta clampés, audit old→new), **prédicat SQL POS-083 baseline-20 %** (COALESCE/CEIL) réellement exécuté, seuils bulk actifs-only, variance id+EAN + unmatched. **Bug pg-mem découvert et prouvé** : `col - $param` inverse les opérandes (`SELECT 12 - $1 [3]` → −9) → la sémantique exacte du décrément est épinglée dans un **jumeau réel-PG** `test/stock-decrement.pg.spec.ts` (gated TEST_DATABASE_URL, +test de concurrence 10 décréments parallèles).
- **P279** `coupon.service.pgmem.spec` (5) — rédemption transactionnelle : FOR UPDATE, **rejeu idempotent** (même clé → réponse cachée, zéro double USED/visite), refus 400/403/404/409, cooldown 15 j (vraie requête ORDER BY usedAt), rollback sur refus (le coupon reste AVAILABLE).
- **P280** `sync.service.pgmem.spec` (5) — **invariant rejeu offline** : re-push du même payload = 0 duplication de vente (dédup batch par id client) ; vente sans id → `rejected_no_id` jamais insérée ; conflit client = server-wins (ligne serveur intacte) ; deltas stock tenant-scoped (SQL `+ :param`, non affecté par le bug pg-mem) ; pull incrémental updatedAt+store.
- **P281** consolidation : suite backend COMPLÈTE rejouée en 5 tranches —
  **194 suites PASS / 3 skip (.pg) · 1306 tests PASS / 5 skip · 0 échec** (Δ v20 : +3 suites actives, +1 suite .pg gated, +16 tests actifs). `tsc --noEmit` EXIT 0.

Commits locaux : `bbc1b05` (P278) · `6034be3` (P279) · `7f330c0` (P280). Interdits respectés : zéro push, zéro secret, zéro prod, zéro migration cible.

---
## État consolidé — 2026-07-02 (jalon PAQUET 277, v20 — cycle 2 Fab 5 : docs alignées + pg-mem money-path)

- **P273** docs alignées sur le réel : CLAUDE.md (44 modules, 21 migrations dont 1725 gated, compteurs tests, 48 entités) + STATE_INDEX (les 10 priorités re-statuées : ✅ 4/5/9 faites, 🟡 3/10 partielles, ⛔ 5 gated).
- **P274** `product-analytics.service.pgmem.spec` (5) — vraies requêtes d'agrégation prouvées sur pg-mem : fenêtres 7j/30j/prev-30j, `completed` uniquement (pending exclu), isolation tenant, `lastSoldAt` = MAX, CA quotidien bucketé jour local magasin, cache TTL store+jour.
- **P275** `sales-guards.service.pgmem.spec` (5) — garde pré-vente (chemin argent) : enrichissement coût côté serveur **tenant-scoped** (produit d'un autre magasin → COST_MISSING, jamais son coût), vente sous coût = critical+blocking persistée `detected`, filtres/tri/count réels de `listAnomalies`, summary groupé par code/sévérité, machine à états review (detected→approved une seule fois, 404 sinon).
- **P276** `customer-visits.service.pgmem.spec` (6) — fenêtre anti-doublon 5 min **par magasin** (vraie requête), insert transactionnel + UPDATE SQL brut `visit_count`/`last_visit_at` (pas d'incrément sur doublon), tri DESC, lecture sécurisée anti-IDOR (autre magasin interdit, bypass admin, 404). Note : artefact pg-mem documenté (incrément SQL brut rendu en texte) — assertions via Number(), réel PG non affecté.
- **P277** consolidation : suite backend COMPLÈTE rejouée en 5 tranches —
  **191 suites PASS / 2 skip (.pg) · 1290 tests PASS / 3 skip · 0 échec** (Δ v19 : +3 suites, +16 tests). `tsc --noEmit` EXIT 0.

Commits locaux : `56b41ed` (P273) · `47c9113` (P274) · `506688f` (P275) · `f3fd2f9` (P276). Interdits respectés : zéro push, zéro secret, zéro prod, zéro migration cible.

---
## État consolidé — 2026-07-02 (jalon PAQUET 272, v19 — reprise Fab 5 : git réparé + re-preuve globale)

- **Git réparé (définitif)** : les locks résiduels `.git/HEAD.lock`/`index.lock` (28 juin, FUSE) ont pu être supprimés cette session → refs de nouveau inscriptibles. Historique complet restauré depuis `pos-recovery.bundle` : branche **`recovery/pos-audit-session`** fetchée (P271 = `579851c`), HEAD basculé dessus **sans modifier le working tree** (diff tree vs bundle tip = 0). Les 4 symlinks `node_modules` trackés par accident retirés de l'index (`28f57d9`). Les commits ne dépendent plus du bundle ; le bundle reste comme filet tant qu'aucun push n'est autorisé.
- **Re-preuve globale bout-en-bout** (la v18 admettait ne pas l'avoir rejouée) — suite backend COMPLÈTE exécutée en 5 tranches (`jest --maxWorkers=2`, 190 fichiers) :
  **188 suites PASS / 2 skip (.pg) — 1274 tests PASS / 3 skip — 0 échec.**
  Front : back-office 6 fichiers/23 tests, pos-desktop 5/23, mobile 3/13 — **14 fichiers / 59 tests PASS**. `tsc --noEmit` backend EXIT 0 · `nest build` RC 0 · `test:security` 10 suites/34 tests PASS.
- **Invariant remises re-vérifié** : `sales/discount-policy.ts` = plafond dur 30 % canal `pos` (jamais contournable), justification obligatoire 21–30 %, code responsable obligatoire, back-office ≤ 100 % admin+motif — conforme aux règles produit, specs dédiées vertes (policy + edge + totals).
- Traçabilité rattrapée : `EXECUTION_LOG.md` couvrait P246 alors que le code était à P271 → entrée de raccord ajoutée (P247→P271 documentés dans PROJECT_STATUS v10→v18) + entrée P272.

**Gates restantes (inchangées)** : TD-INT-RELAY (secrets), MIGRATION-1725 (DB cible + GO), TD-INT-SOCIAL-ENTRIES (décision comptable), runtime DB/e2e run/Capacitor.

---
## État consolidé — 2026-07-01 (jalon PAQUET 271, v18 — session autonome, pg-mem haute fidélité)

- **P271** `outbox-query.service.pgmem.spec` (4) — exécuté contre un **vrai Postgres en mémoire (pg-mem)** via le harness `test/helpers/pgmem.ts`, donc le **query builder keyset réel** est prouvé (pas mocké) : scope tenant (store), filtre de type, pagination curseur `occurredAt|id` (reprise stricte sans perte/doublon), stats groupées par statut/type. Consumer feed Analytik R = `GET /api/integration/events`.

**Non-régression :** slice integration **73 tests verts (10 suites)** ; `tsc --noEmit` EXIT 0. Spec uniquement (harness pg-mem existant réutilisé).

**Compteurs (honnêtes) :** backend 187 → **188 suites**, **+4 tests** (~1270 → ~1274). Cumul session autonome (v12→v18) : **+14 suites, +80 tests**. Méthode pg-mem ouverte pour les prochains services query-heavy (product-analytics, etc.). ⚠️ Suite complète non re-jouée bout-en-bout (cap 45 s).

---
## État consolidé — 2026-07-01 (jalon PAQUET 270, v17 — session autonome suite)

- **P270** `comptamax.service.spec` (3) — contrat de requête du modèle de lecture comptable : `buildDayJournal`/`buildJournalRange`/`buildCashControl` interrogent bien le magasin + la plage jour/période + le filtre de types d'events attendus ; journal vide pour 0 event ; comptage Z-report + paiements capturés. Les maths comptables restent couvertes par les specs helpers purs (journal/cash-control).

**Non-régression :** slice comptamax **61 tests verts (9 suites)** ; `tsc --noEmit` EXIT 0. Spec uniquement.

**Compteurs (honnêtes) :** backend 186 → **187 suites**, **+3 tests** (~1267 → ~1270). Cumul session autonome (v12→v17) : **+13 suites, +76 tests**. Services sans spec colocée couverts cette session : loyalty-card, loyalty-token, inventory-scan, reconciliation, jackpot, customer-visits, notifications, subscriptions, stripe-billing, ai-learning, mobile-auth, external-context, comptamax. Restent (query-heavy ou déjà couverts par `test/`) : product-analytics, fiscal-verify, timewin, airtable-ops (2), outbox-query, sales.service (audit/currency couverts par `test/`). ⚠️ Suite complète non re-jouée bout-en-bout (cap 45 s).

---
## État consolidé — 2026-07-01 (jalon PAQUET 268→269, v16 — session autonome suite)

- **P268** `loyalty-token.service.spec` (6) — **round-trip HMAC QR** (sécurité) : generate→verify OK, rejet mauvais secret / payload falsifié / token malformé / expiré (constant-time, aucune fuite du check échoué), unicité du secret.
- **P269** `external-context.service.spec` (4) — **contrat fail-safe** météo/transport : sans clé (ou coords/station) → contexte NEUTRE `available:false`, **aucun appel réseau** ; getFullContext → overallImpact `neutral`. Applique la règle STATE_INDEX « pas de live sans clé ».

**Non-régression :** slice loyalty-card/sales-ai **66 tests verts (9 suites)** ; `tsc --noEmit` EXIT 0. Specs uniquement.

**Compteurs (honnêtes) :** backend 184 → **186 suites**, **+10 tests** (~1257 → ~1267). Cumul session autonome (v12→v16) : **+12 suites, +73 tests** (…, mobile-auth, stripe-billing, loyalty-token, external-context). ⚠️ Suite complète non re-jouée bout-en-bout (cap 45 s).

---
## État consolidé — 2026-07-01 (jalon PAQUET 266→267, v15 — session autonome suite)

- **P266** `mobile-auth.service.spec` (5) — gardes register/login Wesley Club **avant émission de token** : email invalide, mot de passe < 8, compte dupliqué (409), utilisateur inconnu, mauvais mot de passe (401). Tokens = `mobile-tokens.spec`.
- **P267** `stripe-billing.service.spec` (5) — **gardes des flux monétaires** : Stripe non configuré, plan inconnu, refus checkout plan gratuit, portail sans customer Stripe, webhook **fail-closed** si `STRIPE_WEBHOOK_SECRET` absent (jamais de webhook non vérifiable). Aucun appel Stripe réel (client mocké).

**Non-régression :** slice mobile-auth/subscriptions **34 tests verts (5 suites)** ; `tsc --noEmit` EXIT 0. Specs uniquement.

**Compteurs (honnêtes) :** backend 182 → **184 suites**, **+10 tests** (~1247 → ~1257). Cumul session autonome (v12→v15) : **+10 suites, +63 tests** (loyalty-card, inventory-scan, reconciliation, jackpot, customer-visits, notifications, subscriptions, ai-learning, mobile-auth, stripe-billing). ⚠️ Suite complète non re-jouée bout-en-bout (cap 45 s).

---
## État consolidé — 2026-07-01 (jalon PAQUET 264→265, v14 — session autonome suite)

- **P264** `subscriptions.service.spec` (12) — cycle de vie + **enforcement des limites de plan** : une seule souscription/magasin, plan inconnu rejeté, double-annulation refusée, limite produits (bypass illimité / sous limite / dépassement→403), gate feature, lecture not-found. Denial/limite pures = `subscription-policy.spec`.
- **P265** `ai-learning.service.spec` (4) — boucle d'apprentissage reco : tracking display/click/add-to-cart/conversion, agrégation performance (compteurs + CA), blacklist fail-open sans historique.

**Non-régression :** slice subscriptions/sales-ai **55 tests verts (7 suites)** ; `tsc --noEmit` EXIT 0. Specs uniquement.

**Compteurs (honnêtes) :** backend 180 → **182 suites**, **+16 tests** (~1231 → ~1247). Cumul session autonome (v12→v14) : **+8 suites, +53 tests** (loyalty-card, inventory-scan, reconciliation, jackpot, customer-visits, notifications, subscriptions, ai-learning). ⚠️ Suite complète non re-jouée bout-en-bout (cap 45 s).

---
## État consolidé — 2026-07-01 (jalon PAQUET 262→263, v13 — session autonome suite)

- **P262** `customer-visits.service.spec` (6) — anti-doublon scan 5 min (early-return sans transaction), insert transactionnel + bump `visit_count`, lecture fréquence sécurisée (not-found → 404, cross-store non-admin → 403).
- **P263** `notifications.service.spec` (3) — `generateQrReminderMessage` tenant-scopé, garde not-found, branches message premier-achat (-5%) vs points fidélité.

**Non-régression :** slice customer-visits/notifications/customers/reports **98 tests verts (19 suites)** ; `tsc --noEmit` EXIT 0. Specs uniquement.

**Compteurs (honnêtes) :** backend 178 → **180 suites**, **+9 tests** (~1222 → ~1231). Cumul session autonome (v12+v13) : **+6 suites, +37 tests** (loyalty-card, inventory-scan, reconciliation, jackpot, customer-visits, notifications). ⚠️ Suite complète non re-jouée bout-en-bout (cap 45 s).

---
## État consolidé — 2026-07-01 (jalon PAQUET 257→261, v12 — session autonome, couverture services)

Session autonome (méthode : additif, prouvé, réversible ; zéro gate franchie).

**Livré & prouvé (jest + tsc) :**
- **P257** `loyalty-card.service.spec` (12) — createCard idempotent, gate statut actif sur les vues (403), rotation QR, suspend, `resolveToken` (malformé/inconnu/inactif → 403 ; succès après vérif HMAC).
- **P258** `inventory-scan.service.spec` (7) — validation magasin + store_code, **idempotence offline** (replay clientEntryId), matched vs new, early-return apply sans transaction, roll-up stats session.
- **P259** `reconciliation.service.spec` (3) — **dégradation gracieuse** POS↔TimeWin (TimeWin injoignable → `timewinReachable=false`, résultat POS-only, ne bloque jamais la caisse) + scope employeeId ; `jackpot.service.spec` (6) — config CRUD (lookup actif-only, not-found/forbidden, storeId/id immuables) + comptes du jour.

**Non-régression :** slice loyalty-card/inventory-scan/jackpot/integration/customers/coupon **155 tests verts (21 suites)** ; `tsc --noEmit` EXIT 0. Aucun code métier modifié (specs uniquement) → DI/build inchangés.

**Compteurs (honnêtes) :** backend 174 → **178 suites** (+loyalty-card, +inventory-scan, +reconciliation, +jackpot), **+28 tests** (~1194 → ~1222, 2 `.pg` skip inchangés). ⚠️ Suite complète non re-jouée bout-en-bout (cap 45 s).

**Gates restantes : inchangées** (voir `GATES_READINESS.md`).

---
## État consolidé — 2026-07-01 (jalon PAQUET 252→256, v11 — couverture services CRUD)

Suite directe de v10 : on ferme des trous de couverture « services sans spec colocée » (audit P252).

**Livré & prouvé (jest + tsc + nest build) :**
- **P252** `stock-locations.service.spec` (8) — gardes locations/balances : code dupliqué (400), not-found (404), listing actif-only + ordre, balance par défaut 0, code mis en MAJUSCULE. (Les méthodes transactionnelles receive/transfer/dispatch restent couvertes par `dispatch-policy.spec`.)
- **P253** `pos-session.service.spec` (14) — cycle de vie caisse (invariant γ : une session active par (store, terminal)) : champs requis, refus 2ᵉ session terminal (409), map unique-violation 23505 → 409, refus close cross-store/cross-employee, refus déjà-fermée, **outbox best-effort non bloquant** (ouverture réussit même si l'insert outbox échoue).
- **P254** `occupancy.service.spec` (5) — feed radar in-memory : clamp négatif→0, arrondi, défaut sûr store inconnu, `getView` frais/périmé + niveau ; `mobile-cockpit.service.spec` (4) — cockpit read-only : requête anomalies tenant-scopée `status='detected'`, roll-up summary + overall ok/critical.

**Non-régression (ce paquet) :** slice large stock-locations/pos-session/occupancy/mobile-cockpit/sales-guards/employees/products **137 tests verts (20 suites)** ; `nest build` RC 0 ; `tsc --noEmit` EXIT 0.

**Compteurs (honnêtes) :** backend 170 → **174 suites** (+stock-locations, +pos-session, +occupancy, +mobile-cockpit), **+31 tests** (~1163 → ~1194, 2 `.pg` skip inchangés). ⚠️ Suite complète non re-jouée bout-en-bout (cap 45 s) ; additions purement additives (nouvelles suites uniquement, aucun code métier modifié).

**Gates restantes : inchangées** (voir `GATES_READINESS.md`).

---
## État consolidé — 2026-07-01 (jalon PAQUET 247→251, v10 — points faibles STATE_INDEX)

Paquet de renforcement des couches **maîtrisables** (hors gates externes), suite à `STATE_INDEX.md`.

**Livré & prouvé (jest/vitest + tsc + nest build) :**
- **P247** CRUD couverts : `connected-apps.service.spec` + `terminals.service.spec` (18 tests DI-mockés — branches org/not-found/Stripe-fallback/heartbeat/location-reuse). Comble le trou « services CRUD sans spec ».
- **P248** **Reçu PDF** : endpoint public `GET /api/receipts/:saleId/pdf` → duplicata PDF (StreamableFile `application/pdf`), réutilise le `PdfService` déjà testé, **valeurs figées imprimées verbatim** (NF525, jamais recalculées). Comble le gap « receipt PDF absent » de STATE_INDEX. Tests : magic header `%PDF-`, 404 avant DB sur saleId non-UUID.
- **P249** **Contrat consommateur Analytik R** (`consumer-contract.ts`) : validation d'enveloppe + `ReferenceConsumer` idempotent (dédup par id, skip forward-incompatible, rejet malformé, curseur résumable) + **garde de synchro** qui échoue si un `type` émis n'est pas déclaré. 15 tests. Zéro live.
- **P250** Durcissement clients : mobile `deviceId` + `network` (8 tests unitaires, stubs navigateur) → mobile 3 suites/13 ; customer-app **ErrorBoundary** (anti écran blanc, parité mobile).
- **P251** e2e Playwright **déjà scaffolé** (`e2e/pos-smoke.spec.ts`, parcours argent login→scan→paiement) : spec **collectable** prouvée (`playwright --list`), câblée en CI (`test:e2e:list`) ; mobile vitest ajouté en CI ; gates runtime documentées dans `GATES_READINESS.md`.

**Non-régression (ce paquet) :** slices adjacentes vertes — intégration/receipts/terminals/connected-apps/documents **97 tests**, stock/reports/comptamax **149 tests**, gardes sécurité **27 tests** ; `nest build` RC 0. Additions purement additives (3 nouvelles suites backend + 2 tests receipts).

**Compteurs (honnêtes) :** backend passe de 167 → **170 suites** (+connected-apps, +terminals, +consumer-contract), **+35 tests** backend (1128 → ~1163, 2 `.pg` skip inchangés). Front mobile +8 tests (+2 suites). ⚠️ Suite backend complète **non** re-jouée bout-en-bout ce paquet (cap 45 s/commande) : jalon 167/1128 tient, additions prouvées isolément.

**Gates restantes (inchangées, non franchies)** — voir `GATES_READINESS.md` : TD-INT-RELAY (secrets), MIGRATION-1725 (accès DB cible), TD-INT-SOCIAL-ENTRIES (décision comptable) + gates runtime : **e2e run** (chromium+backend seedé), **build natif Capacitor** (`@capacitor/*` non installés en sandbox), **PIN login 500** (à vérifier en runtime DB).

---
## État consolidé — 2026-07-01 (jalon PAQUET 202, v9)

**Backend : 167 suites PASS / 2 skip (169) ; 1128 tests PASS / 3 skip.** (`jest`, maxWorkers=2/runInBand)
- 2 suites skip = `test/*.pg.spec.ts` (auto-skip sans `TEST_DATABASE_URL` — CI Postgres réel).
- `tsc --noEmit` EXIT 0 · `nest build` RC 0.

**Front : 11 fichiers vitest / 46 tests PASS** (back-office 6/23 + pos-desktop 5/23) ; `vite build` ×2 verts (back-office ~1989 modules, pos-desktop ~2082 modules) ; `tsc --noEmit` EXIT 0 sur les 2. CI (`.github/workflows/ci.yml`) exécute lint + tests backend + vitest front + builds.

**Gate front (TD-FE-ROLLUP-NATIVE) levé** : binaire rollup natif présent → front exécutable en sandbox et CI.

### Historique (jalon PAQUET 133, v8) — pour mémoire
- 150 suites / 1047 tests ; 130 suites/883 unitaires + 20 suites/164 intégration pg-mem.

Épic intégration POS↔Comptamax24↔TimeWin24 (+prep Analytik R) : 62 paquets (71→133).
Détails commandes : `packages/backend/TESTING.md`. Détail intégration : `INTER_SYSTEM_INTEGRATION.md` (§A→§J).

Corrections métier récentes prouvées : avoir partiel sans fuite centime (P127), anti sur-paiement non-espèces (P128), garde NF525 cohérence total vente (P131), sécurité CSV 5/5 exports (P113-114).

Dette ouverte (documentée, non franchie) : TD-INT-SOCIAL-ENTRIES, publisher HTTP réel (secrets), migration 1725 (DB), e2e .pg (Postgres/CI), TD-TEST-DB-SERIAL, TD-FE-ROLLUP-NATIVE (build/vitest front en CI Linux uniquement).

Axe interfaces front/back-office : 16 paquets (140→155) — écrans Comptabilité, Supervision intégration, Santé système, Dettes ouvertes, remise responsable caisse (POS-054), **écart d'inventaire reconstruit** (helper pur `computeStockVariance` → endpoint read-only `POST /stock/variance` → écran branché → parseCounts util). Dette TD-FRONT-INVENTORY-VARIANCE **RÉSOLUE** (P153). Non-régression globale re-prouvée P156 : 151 suites PASS/2 skip, 1059 tests PASS/3 skip.

Arbitrage caisse hors-ligne : **TD-FE-OFFLINE-DISCOUNT RÉSOLUE** (P159) — remise responsable bloquée hors-ligne (PIN serveur invérifiable, cohérent NF525 + paiements QR/wallet Internet-only). Helper pur `manual-discount-guard.ts` câblé POSPage (bouton désactivé + garde défensive à la validation).

## 6. Gel des blocages externes (P358 — 2026-07-02, jalon v35)

Tout le prouvable-en-sandbox est épuisé (P332→P355 : 16 commits, backend 213 suites/1413 tests, fronts 26 fichiers/137 tests, 0 échec). Liste GELÉE des blocages restants, avec propriétaire :

| # | Blocage | Propriétaire | Support préparé |
|---|---|---|---|
| 1 | Révocation des 2 anciennes clés (PRIM + Google Cloud) | Omar (consoles) | `SECRETS_REVOCATION_PLAN.md` (P356) — pas-à-pas, impact nul démontré, plan purge historique GATED |
| 2 | Migrations 1725→1728 sur Neon | Omar (sa machine) | `scripts/run-gate2.sh` + `PRE_GATE2_CHECKLIST.md` (P357) |
| 3 | Clé PRIM dans le `.env` de CE clone (si backend lancé d'ici) + Google Maps différé (CB) | Omar | Lignes commentées prêtes dans `.env` ; mode no-key prouvé — non bloquant (TD-PRIM-ENV-CLONE) |
| 4 | TW24 live + PIN login prod 500 (S1) | Omar (secrets Railway / accès prod) | TIMEWIN24_CONTRACT.md, MONITORING-PLAYBOOK.md |
| 5 | Paywin24 + Comptamax24 | Externe (specs+accès API) | Outbox prête (1725, événements sale.completed/voided) ; OUTBOX_RELAY_KIT.md |
| 6 | Matériel physique : WisePad (capture différée + paiement réel), imprimante BLE, caméra scanner | Omar (session matériel) | Moteurs/exécuteurs/trames tous prouvés sous simulation (POS-033/037/042) — seuls les adaptateurs physiques restent |
