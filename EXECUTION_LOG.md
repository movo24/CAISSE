# EXECUTION_LOG.md — journal d'exécution (chantier modulaire)

> Append-only. Chaque entrée : date, action, modules, vérifs lancées + résultat, commit.

---

## 2026-06-21 — Reprise méthode modulaire autonome

### Audit + reconstruction
- Orientation repo + **vérification centrale** (tsc 5 packages, tests par package). Faits : backend/backoffice/pos tsc ✅ ; mobile ⛔ (vite-env) ; customer-app ⛔ (dep capacitor). Tests : backend 543, backoffice 12, pos 75.
- **Audit parallèle 10 agents** (workflow `pos-caisse-modular-audit`) → 94 modules cartographiés (48✅/27⚠️/12🔄/4⛔/3⬜), 50 actions P0/P1, registre dette.
- **Fichiers de suivi créés/harmonisés** : `MASTER_ROADMAP.md` (supersède `MASTER-PLAN.md`), `PROJECT_STATUS.md`, `MODULE_SPECS.md`, `TECHNICAL_DEBT.md` (supersède `DEBT.md`, D1 conservé + D2–D15), `EXECUTION_LOG.md`.

### M703 — mobile tsc réparé (P1)
- Ajout `packages/mobile/src/vite-env.d.ts` (vite/client + ImportMetaEnv VITE_API_URL), miroir backoffice.
- **Vérifs** : mobile tsc ✅, vitest **5/5** ✅.
- **Commit** `6ce722c`.

### Fichiers suivi + P0 (commit fee2c0e)
- 5 fichiers de suivi créés + harmonisation (DEBT→TECHNICAL_DEBT redirect, MASTER-PLAN bannière supersédé).
- **P0/M802/D6** : token Railway en clair rédigé (`MONITORING-PLAYBOOK.md:168` → `${RAILWAY_TOKEN}`). Rotation = ⛔ owner.

### Cluster sécurité P1 (commit a128bfd) — verify-then-fix contre le code réel
- **M406** connected-apps : `api_key` retiré des réponses GET + `@Roles('admin')`.
- **M203/M208** : `@Roles('admin')` sur GET org/units/stores (list+detail) ; non-admins gardent `/stores/me|accessible`.
- **M301/D12** : `otpCode` retiré de la réponse `POST /customers` ; 2 specs adaptées (lecture OTP via `otpStore`, pas la réponse).
- **M403/D5** : `POST /sync/push` scope `storeId` via `resolveStoreId(req,…)`.
- **Vérifs** : backend tsc ✅, jest **78 suites / 543** ✅ (zéro régression).

### M005 (commit b9fdebe)
- `SalePaymentDto` : `store_credit` whitelisté + `creditNoteCode` ajouté ; spec contrat DTO. tsc ✅, jest 37 (dto+sales) ✅.

### M704 — investigué, NON appliqué (env partagé)
- `@capacitor/preferences` manquant ⇒ customer-app tsc échoue. Fix **vérifié** (install → tsc exit 0) MAIS `npm install -w` depuis le worktree a **remplacé le symlink node_modules par un dir réel incomplet** → cassé backend/backoffice/pos/mobile (2159/52/279/64 erreurs). **Recovery** : symlink restauré + churn npm (package.json/lockfile) revert → 4 packages re-✅, customer-app re-1-erreur. Conclusion : manifeste déjà correct ; à résoudre par `npm install` dans un checkout normal (hors worktree symlinké). Aucun mute du store partagé.

### M108 (commit df08a09)
- La spec `test/stock-reconciliation.spec.ts` existait déjà (auditeur l'avait ratée — vérif source-of-truth). Ajout : boundary exact 19/20/21 % + chemin reject (no stock change, double-confirm refusé). jest 7/7.

### M803 (commit c65a89e) — doc refresh CLAUDE.md (safe)
- Inventaire factuel remis à jour : modules 37→42 (+documents/fiscal/pos-session/promo-codes/stock-reconciliation), entities 45→53, migrations 1716→1743, tests 405/49→543/81, pointeur DEBT→TECHNICAL_DEBT + bloc suivi vivant. Doc-only, aucune logique touchée.

### Gate de validation (recadrage périmètre POS)
- Safe autonome épuisé. P1 restants = SENSIBLES (fiscal verifyChain+migration / stock réel source unique / RGPD / receipts XSS) ⇒ STOP + demande de GO owner avant exécution.
- **GO owner reçu pour M006/M402 uniquement** (les 3 autres restent en attente, non touchés).

### M803 (commit c65a89e) — déjà journalisé plus haut.

### M006/M402 (commit 4355922) — durcissement chaîne, GO owner
- **Vérif source-of-truth** : le verifier fiscal (`FiscalVerifyService`) faisait DÉJÀ un recompute AUTORITATIF de `fiscal_journal` (payload verbatim) + détection fork/linkage, et `test/fiscal-verify.spec.ts` existait déjà (auditeur l'avait raté). Donc M006 = déjà couvert ; rien dupliqué.
- **M402 (vraie lacune)** : la v1 hachait `details` comme `{}` (bug replacer-array → tamper indétectable) + timestamp haché non persisté. Fix : `computeAuditHashV2` (canonicalisation récursive) + `hashed_at` persisté + recompute v2 dans `verifyChain` (v1 = linkage-only) + index unique anti-fork `(store_id, previous_hash)` + retry doLog + migration 1744 (avec pré-check anti-fork qui échoue bruyamment). Spec `test/audit-chain-verify.spec.ts` (tamper `details` détecté, linkage, v1 linkage-only, retry).
- **Différé volontairement** (sensible, sans GO spécifique) : index anti-fork sur `fiscal_journal` (toucherait la tx de void sans retry) ; recompute autoritatif sales/credit_notes (NF525 PARQUÉ).
- **Vérifs** : backend tsc clean, jest **80 suites / 553** (zéro régression).

### Revue owner M402 (2026-06-22) — sémantique d'échec confirmée + cadrage
- **#1 (décisif) CONFIRMÉ par code** : `AuditService.log` = **transaction séparée**, appels **post-commit** en vente, `try/catch → logger.warn`. ⇒ « op⟺audit » non garanti (pré-existant). M402 a changé fork-silencieux → retry+drop-loggué, sans toucher le couplage. Statut M402 **rétrogradé** : détection ✅ / couplage = lot ouvert (**D16** : décision archi in-tx vs alerte-sur-drop).
- **#2 CONFIRMÉ** : genesis = sentinel `'0'×64` (colonne `previous_hash` NOT NULL), pas NULL ⇒ index unique garantit bien mono-genesis/magasin. Réserve NULL non applicable.
- **#3 diagnostic prod (read-only, à exécuter avec accès prod — non dispo ici)** :
  `SELECT store_id, previous_hash, COUNT(*) FROM audit_entries GROUP BY 1,2 HAVING COUNT(*)>1;`
  (= détecte un fork d'audit DÉJÀ présent, appends concurrents passés ; conditionne aussi l'applicabilité de mig 1744). À lancer avant deploy. **D7-like : besoin accès prod.**
- **#4 → D17** : frontière v1 non-vérifiable documentée + question périmètre NF525 de la chaîne audit (owner/expert-comptable).
- **#5 → D4 reframe** : anti-fork fiscal = LOT OUVERT (design concurrence du void), pas « couvert ».
- **D9 (vérif lecture, autorisée)** : S2 XSS **remédié** (`esc()` correct sur toutes les chaînes des 2 builders HTML) ; résiduel non-exploitable `<title>` ticketNumber non-esc ; S3 public = par design (QR/UUID opaque, reprint/email authed). Aucun patch (lecture seule).

### Prochaine action automatique
En attente owner : (a) décision archi D16 (couplage audit) ; (b) périmètre NF525 D17 ; (c) GO sur M107 (pré-design stock×fiscal d'abord), M302 (politique RGPD×NF525 d'abord), patch D9 `<title>`/expiry. Rien de sensible exécuté sans GO.
