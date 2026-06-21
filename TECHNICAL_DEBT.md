# TECHNICAL_DEBT.md — registre de dette nommée

> **Registre canonique** (supersède `DEBT.md`). Append-only. Une dette = un manque conscient,
> scopé — ni bug silencieux ni TODO perdu. Chaque entrée nomme *ce qui n'est pas couvert*,
> *pourquoi c'est différé*, *ce qui la ferme*. Fermer une dette = une PR qui retire son entrée.
> Les audits datés (`AUDIT-COMPLET.md`, `AUDIT-FINAL-2026-04-01.md`, `INCIDENT-REPORT-2026-04-01.md`)
> sont des snapshots immuables ; leurs findings ouverts vivent ICI.

Statuts : OPEN · IN PROGRESS · BLOCKED (owner/accès) · CLOSED (PR retire l'entrée).

---

## D1 — Reversal fiscal d'une vente **cash** via `createReturn` non couvert
**Status:** OPEN · named debt · fiscal-design PR séparée. **Since:** void-cash-realized guard (#10), 2026-06-12.

**Contexte.** Le guard `void-cash-realized` (`sales.service.ts` ~L933+) refuse de `void` une vente avec leg cash réalisé ; l'annulation doit passer par le **retour** (`createReturn`, remboursement cash). Le trou de sécu (voider du cash réalisé) est **fermé**.

**Ce qui n'est PAS couvert (la dette).** Le comportement chaîne-fiscale / `fiscal_journal` du **chemin remboursement cash `createReturn`** n'est **pas testé** : M3/M4 ont été exercés sur `void` puis transposés vers `store_credit`/`card`. Aucun test ne prouve qu'un retour cash produit l'événement/chaîne/effet Z corrects.

**Pourquoi différé.** C'est une question de *design* fiscal (le retour cash émet-il son propre événement journal ? chaînage ? ventilation Z), pas un fix une-ligne.

**Ce qui la ferme.** PR fiscal-design : (1) spécifie la sémantique retour-cash, (2) spec `createReturn`-cash end-to-end, (3) retire cette entrée. **Cross-refs.** `CLAUDE.md` Known Issues ; `sales.service.ts` ; `void-cash-realized-guard.spec.ts`, `avoir-m1-m3.spec.ts`, `void-m4-journal-chain.spec.ts`.

---

## D2 — connected-apps expose `api_key` + pas de scoping org  (M406)
**Status:** OPEN · **P1 SÉCU.** `GET /connected-apps` (findAll/findOne) renvoie `api_key` en clair et n'est pas scopé à `req.user.organizationId` ⇒ un caissier lit les credentials tiers de n'importe quelle organisation.
**Ferme :** `@Exclude` sur la colonne (ou DTO de réponse sans `api_key`) + `@Roles` + scoping org ; à terme colonne chiffrée (pattern airtable-ops). Confirmé par be-platform + xcut.

## D3 — audit `verifyChain` ne recalcule pas le hash  (M402)
**Status:** OPEN · **P1 INTÉGRITÉ.** `verifyChain` valide seulement le lien prev→current ; ne recompute pas `currentHash` depuis le contenu, et le timestamp ISO haché n'est pas persisté ⇒ une falsification de `details` est indétectable. Mutex par magasin in-process only (pas d'index DB anti-fork multi-instance).
**Ferme :** recompute depuis champs stockés + persister le payload canonique + index unique `(store_id, previous_hash)` + spec détectant un `details` falsifié.

## D4 — fiscal `verifyChain` (fiscal_journal) idem D3 + portée journal  (M006)
**Status:** OPEN · **P1.** Même faiblesse recompute que D3 côté `fiscal_journal` ; décision ouverte : toutes les ventes/retours doivent-ils s'ajouter au journal (pas seulement les voids) ? payload canonique à persister pour recompute autoritatif. **Note :** NF525 Z-seal **PARQUÉ** — ne pas construire la certif.

## D5 — sync `POST /push` fait confiance à `payload.storeId`  (M403)
**Status:** OPEN · **P1 AUTHZ.** L'endpoint déjà livré ne confronte pas `payload.storeId` à `req.user` (pull/status le font via resolveStoreId) ⇒ un device peut écrire dans un autre magasin. **Ferme :** scoper/valider storeId contre l'utilisateur. (Distinct de la porte offline-sale PARQUÉE.)

## D6 — token Railway en clair dans `MONITORING-PLAYBOOK.md`  (M802)
**Status:** IN PROGRESS (repo) / BLOCKED (rotation owner). Token `TOKEN=4714644a-…` ligne 168. **Rédaction dans le fichier = faite cette campagne** (stoppe la propagation), MAIS il reste dans l'historique git et **doit être ROTÉ** côté Railway. **Ferme :** rotation du token par l'owner (accès Railway) + purge historique si jugé nécessaire.

## D7 — séparation des bases prod non confirmée  (INCIDENT 2026-04-01)
**Status:** BLOCKED/VERIFY · **P0 si non fait.** Le postmortem documente une perte de données par base partagée cross-ORM. Si la séparation n'a pas été réalisée, le risque de destruction shared-DB est **live**. **Ferme :** preuve de séparation (env/URLs distinctes) ou exécution de la séparation (action prod = owner GO).

## D8 — clés API fuitées en historique git  (AUDIT-FINAL S1)
**Status:** BLOCKED (owner). Clés réelles committées (`docker/.env.production.example` historique). **Ferme :** rotation des clés (accès secrets) + décision purge historique. Action owner.

## D9 — XSS receipts + endpoint receipts public  (AUDIT-FINAL S2/S3)
**Status:** VERIFY · **P1.** XSS dans le HTML reçu + endpoint receipts accessible sans auth (snapshot 2026-04-01). **Ferme :** confirmer remediation contre le code actuel (échappement HTML + guard) ; sinon corriger.

## D10 — Stripe : idempotency `Date.now()`, intent non lié, conflict no-op, EUR/taxRate20 en dur  (AUDIT-COMPLET)
**Status:** VERIFY/OPEN · **P1/P2.** Findings de mars à reconfirmer contre le code actuel (capture decision 6 a déjà touché ce chemin). **Ferme :** vérifier chaque point ; idempotency déterministe ; lier `stripePaymentIntentId` ; devise/taux depuis le store.

## D11 — Double source de vérité stock (legacy column vs stock_balances)  (M107)
**Status:** OPEN · **P1.** `product.stockQuantity` et `stock_balances` peuvent diverger (syncLegacyStock). **Ferme :** trancher+documenter la source unique + `CHECK(quantity>=0)` + specs.

## D12 — customers `POST` renvoie `otpCode`  (M301)
**Status:** OPEN · **P1 SÉCU.** L'OTP est renvoyé dans la réponse de création. **Ferme :** ne renvoyer que customer + qrCodeDataUrl (log dev-only). (P2 : store OTP en Redis pour multi-instance.)

## D13 — Pas d'effacement RGPD client  (M302)
**Status:** OPEN · **P1.** Aucune anonymisation/soft-delete des PII client. **Ferme :** `anonymizeCustomer` + soft-delete + endpoint admin audité (+ export portabilité).

## D14 — Jackpot fallback silencieux  (AUDIT-COMPLET, M306)
**Status:** VERIFY · **P2.** Faiblesse sécurité notée (403 vs fallback silencieux). **Ferme :** confirmer + durcir le chemin d'autorisation.

## D15 — Dérive doc CLAUDE.md + nits  (M803)
**Status:** OPEN · **P3.** Counts stale (37/45/405/mig1715 vs 42/53/543/1743) ; promo-codes & stock-reconciliation non documentés ; barrel `entities/index.ts` omet 11 entités (inoffensif) ; seeds PIN 1234/5678 littéraux ; `migration:run` pointe un chemin typeorm/cli.js inexistant ; health "2s" vs 5s ; Z vs KPI colonnes date différentes. **Ferme :** rafraîchir CLAUDE.md + corriger les nits.
