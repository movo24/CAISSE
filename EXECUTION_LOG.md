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

### Prochaine action automatique
Suite P1 correctness : M108 (spec réconciliation) → M006/M402 (verifyChain recompute + index anti-fork) → M107 (source unique stock) → M302 (RGPD).
