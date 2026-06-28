# RAPPORT 20h — Mandat 5h autonome

**Démarrage** : voie B (Omar parti, voie A expirée, voie C rejetée).
**Cadre** : structurel > convention, fail-safe, un invariant = un commit, journal temps réel, irréversible-ambigu = défère.
**Garde-fou non-négociable** : rien sur `main`, sous aucun prétexte. Branches feature uniquement.

---

## 1. Fait / Pas fait

*(rempli en continu)*

- [x] Démarrage rapport
- [x] Étape 1 — préparation clics void (PR description, 6 issues, recommandations pré-répondues) → **Annexe A**
- [x] Étape 2.A — faits Q1/Q2/Q3 verbatim → **Annexe B**
- [x] Étape 2.B — scoping dérivé (1a)+(1b) → **Annexe B**
- [x] Étape 2.C — implémentation (1a) primitive session POS (module, service, controller, DTO, tests pg-mem 16/16, branche `feat/pos-session-primitive`, commit `1d7a9a5`, push)
- [x] Étape 2.C-suite — régression suite complète **469 passed + 1 skipped / 470 total** + commit + push ✓
- [ ] (1b) binding — **bloqué par D1** (irréversible-ambigu déféré au mandat)
- [x] Étape 3 — audit TimeWin24 read-only → **Annexe C**, 6 questions auditées, 5 découvertes documentées (dont D4 critique sur circularité écriture)

## 2. Journal de décisions

*(une ligne par arbitrage : quoi, pourquoi, ce que ça exclut)*

### J1 — Voie B retenue (Omar parti, voie A expirée, voie C rejetée)
**Décision** : continuer en voie B sans accès GitHub (PR non ouverte, branches feature uniquement).
**Pourquoi** : Omar parti = pas de clic possible (voie A) ; voie C (token écriture) rejetée par accord toute la session — pas d'élévation de privilège pendant absence du détenteur. Cohérent avec "pas de clé au bord" appliqué au workflow lui-même.
**Ce que ça exclut** : merge de void pendant les 5h. La fenêtre zéro-risque attend 20h.

### J2 — Faits Q1/Q2/Q3 grepés VERBATIM avant tout scoping
**Décision** : capturer les trois faits verbatim dans le rapport (§Faits Q1/Q2/Q3) AVANT de dériver le scoping de l'étape 2.
**Pourquoi** : ajustement du mandat — "les faits commandent le découpage, pas l'inverse". Si les faits contredisent un scoping pressenti, c'est le scoping qui plie.
**Ce que ça exclut** : "j'ai scopé en (1a)+(1b)" comme assertion sans support. Les faits sont rapportés d'abord.

### J3 — Découpage (1a) primitive + (1b) binding
**Décision** : implémenter en deux PRs séparées, (1a) primitive session POS d'abord, (1b) binding ensuite.
**Pourquoi** : faits Q1 prouvent que la session est vestigial (DDL prêt, runtime absent). Introduire la primitive sans coupler le bind = même logique blast-radius que void/createSale. (1a) ship vite, (1b) itère contre les appelants. Pattern éprouvé en session précédente.
**Ce que ça exclut** : implémenter le binding maintenant. Sans primitive opérationnelle, le bind n'a rien à lire. Bundlés = revert de l'invariant = sauter la primitive.

### J4 — Primitive (1a) compatible strate II (ajustement Omar §3 respecté)
**Décision** : la primitive (1a) est introduite avec l'entité `PosSessionEntity` existante, qui contient déjà tous les champs strate II (`timewin_session_token`, `offline_mode`, `permissions jsonb`, snapshots). Pas de refonte à anticiper.
**Pourquoi** : l'entité actuelle a été conçue avec strate II en tête (probablement même intention en session précédente). Les champs additionnels strate II (`presence_factor`, `authorization_source`, etc.) seront des migrations additives ultérieures, pas une refonte.
**Ce que ça exclut** : refaire une primitive ad-hoc qui devrait être refaite plus tard. Compatibilité forward préservée.

### J5 — Option (α) "session auto-créée au login" écartée de (1a)
**Décision** : (1a) implémente l'option (β) "création explicite par POST /sessions/open" (potentiellement (γ) terminal-aware si `X-Terminal-Id` peuplé). L'option (α) "auto-créer au login dans auth.service" est écartée de (1a).
**Pourquoi** : (α) coupler auth↔session = décision avec implications front/sécurité/UX que je n'ai pas le mandat de trancher seul. (β) est strictement plus simple et compatible avec (α) ou (γ) plus tard.
**Ce que ça exclut** : ne PAS toucher à `auth.service.ts` dans (1a). La session sera explicitement ouverte par appel API distinct, après login.

### J6 — terminal_id : accepté DTO mais non-persisté à (1a)
**Décision** : le DTO `OpenSessionDto` accepte un `terminalId` optionnel, mais le service NE LE PERSISTE PAS. Il est logué pour observability.
**Pourquoi** : l'entité `PosSessionEntity` n'a pas de colonne `terminal_id`, et le champ `permissions` est typé `Record<string, boolean|number>` (donc inutilisable pour un string id). Persister `terminalId` dans `permissions` violerait le type ; ajouter une colonne `terminal_id` dans (1a) serait une **migration de schéma**, donc destructive-ambiguë (à la fois change de design strate II et de prod schema) → déférée.
**Ce que ça exclut** : DTO surface stays forward-compatible, schema addition deferred. (1b) ou strate II ajoutera `terminal_id` comme migration additive.

### J7 — (1b) binding bloqué par D1 — ne pas forcer
**Décision** : ne PAS implémenter (1b) binding pendant les 5h.
**Pourquoi** : D1 (α/β/γ) reste déféré. Implémenter (1b) lierait `createSale.employee_id` à une primitive dont la sémantique de durée n'est pas tranchée. Si (α) est retenu plus tard, la session a la durée du JWT (renouvelée à refresh) → le bind doit considérer rotation de session. Si (γ) est retenu, il faut un `terminal_id` qui n'existe pas encore. (1b) sans D1 = code à refaire.
**Ce que ça exclut** : pas de PR (1b) dans ce mandat. Étape 3 (audit TimeWin24) prend la suite.

## 3. Découvertes

*(trous révélés, nommés, non corrigés en douce)*

### Découverte 1 — `pos_sessions` est une table vestigial
**Trouvé en** : grep Q1.5.
**Description** : la table `pos_sessions` est créée par migration `1710900000000-RemoveRHAddPOSSessions` et présente en prod. L'entité TypeORM est définie. **MAIS** : aucun code applicatif n'écrit dedans, aucun ne lit. Le commentaire docstring de l'entité décrit une intention ("Created when employee logs in via TimeWin24 auth") qui n'est pas implémentée.
**Impact** : la couverture "session active" supposée par toute discussion strate II n'existe pas en pratique. Le bind employee_id↔session est posable parce que les colonnes existent, mais la session elle-même n'a jamais été créée par /CAISSE.
**Pas corrigé en douce** : PR (1a) introduit la primitive pour résoudre cela ; (1b) binding awaits Omar review.

### Découverte 2 — `req.user.employeeId` vient du JWT signé, pas du body (bonne nouvelle modérée)
**Trouvé en** : grep Q2.1-Q2.3.
**Description** : `employee_id` consommé par `createSale` vient de `req.user.employeeId`, posé par `JwtStrategy.validate` à partir de `payload.sub`. Standard JWT signé. **Pas du body client.**
**Impact** : profil de risque limité par rapport au scénario "claim arbitraire body". L'attaque skim-by-attribution requiert vol/partage du token, pas simple manipulation HTTP. **Reste un trou** : pas de bind à un événement physique de présence.

### Découverte 3 — Aucun guard NestJS ne vérifie une session active
**Trouvé en** : grep Q3.2.
**Description** : `find modules -name "*.guard.ts"` ne retourne aucun guard lié à `pos_sessions`. `createSale` et `voidSale` ne consultent pas l'état de session. Le lifecycle est inexistant en pratique.
**Impact** : (1b) binding doit créer ce guard ; (1a) primitive ne le crée pas pour rester découplée du chemin métier.

### Découverte 4 (CRITIQUE) — /CAISSE écrit dans TimeWin24, l'autorité de présence
**Trouvé en** : audit Q5.3 + C.7.
**Description** : `clockIn`, `clockOut`, `updateStoreSchedule`, `pushEvent` sont des **écritures** /CAISSE → TimeWin24. /CAISSE n'est pas un simple lecteur ; il est aussi un client privilégié qui pollue le registre TimeWin24. Si TimeWin24 sert d'autorité de présence (B leg de la composition strate II), alors :
- Compromis /CAISSE = peut injecter pointages frauduleux dans TimeWin24.
- A leg (re-validation backend) confronte à TimeWin24 → confronte une source que /CAISSE a écrite. **Auto-validation circulaire.**

**Pas corrigé en douce** : l'issue 6 (audit TimeWin24) doit être amendée pour nommer cette circularité comme dette d'architecture. Suggestion : (i) restreindre l'écriture de pointages à un acteur isolé (badge physique, terminal dédié, pas le backend /CAISSE), (ii) ou ajouter une couche d'attestation indépendante de /CAISSE.

### Découverte 5 — TimeWin24 ne signe pas ses réponses (asymétrie d'auth)
**Trouvé en** : grep Q6.3.
**Description** : /CAISSE signe ses requêtes vers TimeWin24 (HMAC + Bearer), mais TimeWin24 ne signe pas ses réponses. Sous TLS sain, OK. Sous TLS compromis, /CAISSE peut être nourri d'événements falsifiés.
**Impact** : sous-jacent du B leg ; à porter à l'audit (6a) si l'audit léger comprend tests sur TLS / pinning.

### Découverte 6 — Pas de webhook entrant TimeWin24 → /CAISSE
**Trouvé en** : grep Q8.
**Description** : aucun endpoint /CAISSE pour recevoir un push de TimeWin24. Si TimeWin24 modifie un shift post-hoc, /CAISSE ne le sait jamais (TTL cache 30 min → resync au prochain miss).
**Impact** : /CAISSE peut servir une donnée périmée de 30 min. Pas critique pour le métier actuel, à prendre en compte pour strate II "B leg fidèle au présent".

## 4. Points déférés

*(irréversibles-ambigus avec options posées, jamais tranchés seul)*

### D1 — Quand introduire une session POS ? (α/β/γ) — déféré pour décision Omar
**Contexte** : (1a) primitive session POS introduit un endpoint `POST /sessions/open` (option β/γ). Mais une question reste ouverte sur la **stratégie de couplage avec l'authentification** :

- **(α) Auto-créée au login** : `auth.service.loginByPin/loginByEmail` crée la session avant de signer le JWT.
  - Avantage : pas d'étape utilisateur supplémentaire.
  - Inconvénient : couple session↔token JWT (durée = token = renouvelée à chaque refresh ?), pas de bind explicite à un terminal physique.

- **(β) Création explicite après login** *(retenu pour (1a))* : le front POS appelle `POST /sessions/open` après login, avec `employee_id` du JWT.
  - Avantage : séparation auth/session, durée = explicite, contrôle UX.
  - Inconvénient : nécessite cooperation front (mais c'est de toute façon nécessaire).

- **(γ) Terminal-aware** : `POST /sessions/open` accepte un header `X-Terminal-Id`, posé par le terminal. Session bound au terminal physique.
  - Avantage : bind terminal-employee (cf. strate II "binding terminal_id").
  - Inconvénient : refactor déploiement (`X-Terminal-Id` à poser partout), couplage matériel-logiciel.

**Pourquoi déféré** : choisir entre (α/β/γ) a des implications front, sécurité (durée de vie de la session ≠ durée du JWT), et déploiement (`terminal_id` à propager). Décision UX/architecture qui dépasse le mandat de débloquer prod.

**État pendant les 5h** : (1a) est spec'ée et implémentée avec (β), avec ouverture conceptuelle pour (γ) plus tard (header `X-Terminal-Id` accepté comme paramètre optionnel). (1b) ne sera pas lancé avant que cette décision soit prise — sinon je binderais à une primitive dont la sémantique de durée n'est pas tranchée.

### D2 — Quand voider est-il "depuis cette session" ? — pré-existant, à trancher avec D1
**Contexte** : si une vente est créée dans une session A (employee A), et qu'un autre employé (B, dans une session B sur un autre terminal) voide cette vente — quel `employee_id` est porté par le void ?
- Option 1 : l'`employee_id` de B (qui voide).
- Option 2 : l'`employee_id` de A (qui a vendu).
- Option 3 : interdire la cross-session void (B ne peut pas voider une vente d'une autre session).

**État pendant les 5h** : non bloquant pour (1a) (la primitive n'implique rien sur le void). Sera tranché avec (1b).

## 5. État exact

### Branches & commits

**`main` (origin/main)** : `fb30094` "fix(build): declare nodemailer + make Docker build use tsconfig.build.json" — INCHANGÉ pendant ces 5h. Pas de push sur main.

Note : ce commit `fb30094` est de la session précédente (Omar l'avait mergé). `main` actuel **n'inclut pas** le fix void (`5fada26`) qui reste sur sa branche feature.

**`fix/void-cash-realized-guard`** :
- Commit : `5fada26` "fix(sales): block void on realized cash payments"
- Branche poussée sur origin (faite en session précédente).
- État : prête à PR + merge à 20h (voir Annexe A).

**`feat/pos-session-primitive`** :
- Commit : `1d7a9a5` "feat(pos-session): introduce session primitive (1a of session-binding)"
- Branche poussée sur origin pendant ces 5h.
- État : prête à PR à 20h.

### Prod

- **Backend Railway** : pas redéployé (rien de mergé sur main pendant les 5h).
- **`caisse_pos` Neon** : intact, toujours vide.
- **Aucune action prod**.

### Suite de tests (sur branche feat/pos-session-primitive)
- TSC clean.
- Jest : **469 passed + 1 skipped (E2E gated) / 470 total**.
- Nouveaux tests : 16/16 (primitive session POS).

### Fichiers locaux non commités
- `RAPPORT_20H.md` (cet artefact d'organisation, untracked, ne sera jamais commité).

### Travail au-delà de 5h
- (1b) binding : DÉFÉRÉ par D1.
- PR fix/void-cash-realized-guard → ouverture/merge : DÉFÉRÉ par voie B (clics à 20h).
- Audit TimeWin24 plus profond : limites de l'audit read-only atteintes (cf. C.6) ; (6a)+(6b) hors-mandat pour les 5h.

---

# ANNEXE A — CLICS VOID (5 min mécaniques à 20h)

## A.1 — Ouvrir la PR

URL : https://github.com/movo24/CAISSE/pull/new/fix/void-cash-realized-guard
Branche source : `fix/void-cash-realized-guard`
Branche cible : `main`
Titre PR : `fix(sales): block void on realized cash payments`

### Description PR (copier-coller intégral)

```
## Scope

Integrity guard for the /CAISSE fiscal journal against cash exfil.
A sale with a realized cash leg cannot be undone by void: cash has been
taken, the sale fiscally happened, erasing it would be a false declaration.
Annulation must go through createReturn (compensation, not erase).

## Out of scope (follow-ups created as issues — link them when filed)

- **#unified-reversibility (card path)** — void-after-card-settled is the
  same NF525 obligation, gated by a PSP settlement signal. The cash guard
  ships the sharp slice; the unified guard is the next step.
- **#authZ-void-gap** — voidSale has no role gate (manager-cap only gates
  managers). Pre-existing dette revealed in review. Should roll with or
  before #unified-reversibility.
- **#createReturn-cash-test-gap** — createReturn with refundMethod='cash'
  has no credit_notes chain invariant test. Pre-existing, revealed by
  retiring the void-cash specs that masked it.

## What this PR does

1. Guard in `sales.service.ts`: blocks `voidSale` when `sale.payments` has
   a `cash` leg with `amountMinorUnits > 0`. Placed after the manager-cap
   authZ (so 403 wins over 409 when both apply). Returns
   `ConflictException` (409 — resource state conflicts with the operation).
   Logs a denied `VOID_ATTEMPTED` business event with
   `reason: 'cash_leg_realized'` (detective signal on repeated probing).

2. New dedicated spec `void-cash-realized-guard.spec.ts`: 4 tests covering
   cash-only refused, mixed cash+card refused, card-only allowed (out of
   scope of cash guard), and **cashier (non-manager)** refused on cash —
   the actor the manager-cap doesn't gate, structurally stopped by this
   guard, not by a role check that doesn't exist.

3. Fixtures migrated in M3 (mixed leg cash→card), M4 (sellAndVoid helper +
   immutability test cash→card), fiscal-verify (sell helper cash→card).
   Each migration is annotated with the same rationale: invariants under
   test are tender-agnostic — the cash was incidental, not the subject.
   Realized cash-leg coverage now lives in the dedicated spec.

4. Mock contract fix in `sales.service.audit.spec.ts`: adds `payments: []`
   to the mocked sale, honoring `findOne`'s real contract
   (`relations: ['lineItems', 'payments']`). Pre-existing gap revealed by
   the guard being the first reader of `payments`.

## Tests

TSC clean. Suite: 457 passed + 1 skipped (E2E gated `TEST_DATABASE_URL`) /
458 total.

## Deploy note

`caisse_pos` is currently empty (no sales recorded). Merging this PR while
the production is greenfield is the zero-risk window. Railway auto-deploys
on merge to `main`; the deployment changes voidSale semantics with no
existing data affected.
```

## A.2 — Créer les 6 issues (avant ou après ouverture PR, peu importe)

### Issue 1
**Titre** : `fix(sales): bind employee_id from active POS session, not JWT claim`

**Corps** :
```
Today: createSale reads employee_id from JWT context, derived from login.

Risk in prod, online: skim by mis-attribution — operator logs in under their
own PIN, performs the op, stamps employee_id = self via the JWT claim. A
malicious operator could swap PINs at the terminal between operations.
Detective review sees "Marie did this refund", file clean, lifts.

Fix: derive employee_id from pos_sessions[pos_session_id].employee_id (active
session on the terminal), not the JWT claim. Refuse if no active session
for the terminal.

Prerequisite established by code grep (see RAPPORT_20H.md §faits) — to
verify before scoping the implementation work.

Domain: /CAISSE prod-vivant fix. Same bind-from-session class as the void/cash
guard (PR fix/void-cash-realized-guard), applied to online attribution.
```

### Issue 2
**Titre** : `fix(sales): proper role gate on voidSale (manager-cap only gates managers)`

**Corps** :
```
voidSale has no role gate at all. The manager-cap only gates managers:

    if (employeeRole === 'manager' && total > 500€) throw

Any other role (cashier, intern, ...) passes ungated. Pre-existing dette;
revealed when reviewing void semantics for the cash-guard PR.

The cash guard (PR fix/void-cash-realized-guard) is role-independent, so
it closes the cash exfil channel even without an authZ fix here. What
remains exposed: unauthorized void of non-cash sales (card pre-settlement)
by a non-manager = journal integrity exposure, not cash exfil.

Should roll WITH or BEFORE the card follow-up (issue #unified-reversibility),
because "non-manager voids a card-settled sale" cumulates this authZ gap
with the card follow-up gap.

Fix shape: proper role gate on voidSale (e.g. @Roles('admin', 'manager') at
controller, or service-level check distinct from the manager-cap). To spec
against actual UX expectations (which roles legitimately void today?).
```

### Issue 3
**Titre** : `fix(sales): unified reversibility guard — void forbidden when any tender realized-irreversibly`

**Corps** :
```
Follow-up to PR fix/void-cash-realized-guard (cash guard).

The cash guard ships the sharp slice (exfil cash, prod-vivant default
greenfield). It is NOT the full fiscal invariant. A card-settled sale has
ALSO fiscally happened — voiding it erases a fiscal event from /CAISSE's
own books (M1-M5 chain), regardless of what the PSP does on the money side.

Generalize via the reversibility pivot:

    Void is forbidden as soon as a tender is realized-irreversibly:
    - cash leg amount > 0 (already enforced by PR fix/void-cash-realized-guard)
    - card leg settled (needs a PSP signal)

Trigger (when to enforce) depends on:
- Available: PSP signal payment_intent.succeeded (Stripe webhook) tracked
  locally on sale.
- Fallback if signal unreliable: conservative block of void-card-completed
  after a presumed settlement window (e.g. 24h post-completion).

Obligation precedes dependency. The PSP signal tells us WHEN to enforce,
not IF the guard exists. /CAISSE's NF525-by-adoption obligation is
tender-agnostic.

Should roll with or after #authZ-void-gap.
```

### Issue 4
**Titre** : `test: createReturn cash→cash credit_notes chain invariant`

**Corps** :
```
Pre-existing test gap, revealed (not caused) by PR fix/void-cash-realized-guard.

createReturn with refundMethod='cash' has no test of the credit_notes hash
chain invariant on the cash refund path. Only cash→store_credit is covered
(e2e-money-flow.spec.ts).

Before the cash guard, this gap was masked: void-cash specs in M3/M4 looked
like they covered "cash reversal", but they tested the erase semantic
(now correctly forbidden). The cash REVERSAL path is via createReturn
(compensation), and that path's M5 chain invariant on cash refunds is
untested.

Note: createReturn is NOT a replacement for void M3/M4 invariants. Restoring
a consumed avoir on createReturn would be a BUG (double credit: original
avoir + new credit_note). createReturn is compensation, not erase. So this
issue is NOT "implement M3/M4 on createReturn" — it's "add a credit_notes
chain test for the existing cash refund path".

Estimated charge: small. One spec, pg-mem, exercise createReturn with
refundMethod='cash' on a card-paid sale (avoid the cash guard), assert
M5 chain link + recompute on the resulting credit_note.
```

### Issue 5
**Titre** : `audit: /CAISSE → Comptamax24 export couture — do returns enter the fiscal total?`

**Corps** :
```
Audit / design question, not a code task yet.

Open question: under NF525-by-adoption, do returns enter the fiscal total
(daily Z report, period totals)? And does fiscal_journal need a mirror
entry for returns, or does the credit_notes M5 chain suffice as a
compensation ledger?

Context: void writes to fiscal_journal (M4). createReturn writes to
credit_notes (M5). Both are append-only chained per store. The void
path's mirror in fiscal_journal exists because erase has no other place
to go. Returns having their own chain (M5) MAY be enough — but the
fiscal total / export to Comptamax24 might want a unified view.

Prerequisite for the unified reversibility guard (#3) to fully land,
and for the strate II reconciliation machine to wire correctly.

Output expected: documented decision + spec of any schema/code change.
Not a coding task at this stage.
```

### Issue 6
**Titre** : `audit: TimeWin24 as presence authority — integrity threat model`

**Corps** :
```
The B leg of the A∧B+C composition (strate II design) assumes TimeWin24
is tamper-evident. /CAISSE has never audited TimeWin24's integrity. If
TimeWin24's records can be retroactively altered by an admin, B becomes
a laundering channel instead of a control.

Two ways forward (probably mix):

(6a) Audit TimeWin24 — apply the structural-not-convention grid to the
partner system:
- Are pointing events append-only? Hash-chained? Mutable by an admin?
- Does the API contract /CAISSE consumes (getTodayShifts, window-overlap
  primitive to confirm) serve a faithful view of the chain, or a
  recalculable aggregate?
- Threat model: who can rewrite a shift in TimeWin24? Under what
  authority? With what traceability?
- Endogenous if same team owns TimeWin24. Contract-based if external.

(6b) Declare hors-strate — like the root enrolment of deployment: name
TimeWin24's integrity as an explicit assumption scoped to the
window-overlap primitive, with re-evaluation triggered by any contract
or integrity change in TimeWin24.

STRICT PREREQUISITE: must happen before any B wiring in strate II code.
Otherwise we build a machine that trusts B and should not.

Action of discovery (parallel, non-blocking): contact TimeWin24 team to
confirm the window-overlap primitive ("does a shift overlap
[last_sync, this_sync] for (employee, store)?"), not point-in-time
(forgeable from terminal-claimed T).
```

## A.3 — Décisions de merge (pré-répondues)

### Décision 1 — Stratégie de merge ?

**Recommandation : Squash and merge.**

Rationnel :
- Le commit `5fada26` sur la branche contient un message verbeux (scope, rationnel, fail-safe, mock fix, dette nommée séparément). C'est précieux sur la branche pour la traçabilité de review.
- Sur `main`, on veut UN commit propre, avec le même message comme description squash. `git log main --oneline` reste lisible.
- "Create a merge commit" laisserait un merge commit + le commit feature, ce qui est redondant pour un PR mono-commit.
- "Rebase and merge" perdrait l'indication de PR dans l'historique.

→ **Squash and merge**, garder le message du commit `5fada26` comme description squash.

### Décision 2 — Supprimer la branche après merge ?

**Recommandation : Oui, supprimer.**

Rationnel :
- Hygiène : pas de couplage à une branche après merge, pas de risque de re-déploiement accidentel d'une vieille branche.
- L'historique de la branche reste accessible via le commit squashé dans `main` et la PR archivée.
- Pas de raison de garder la branche feature vivante.

→ **Supprimer la branche `fix/void-cash-realized-guard`** après merge.

---

# ANNEXE C — AUDIT TIMEWIN24 READ-ONLY (Étape 3)

Cartographie read-only de l'intégration /CAISSE↔TimeWin24, posture threat-model,
état des primitives strate II.

## C.1 — Surface consommée par /CAISSE (Q4)

### Endpoints HTTP appelés (verbatim)

```
GET  /api/health                                      — isHealthy()
POST /api/auth/employee-login                         — loginEmployee()
GET  /api/employees/:id/context                       — getEmployeeContext()
GET  /api/pos-feed/employees?storeId=X                — syncEmployees()
GET  /api/pos-feed/today-shifts?storeId=X             — getTodayShifts()
GET  /api/pos-feed/payroll?storeId=X&month=Y          — getMonthlyPayroll()
GET  /api/pos-feed/store-schedules?storeId=X          — getStoreSchedule()
PUT  /api/pos-feed/store-schedules?storeId=X          — updateStoreSchedule()
GET  /api/pos-feed/store-config?storeId=X             — getStoreConfig()
POST /api/attendance/clock-in                         — clockIn()
POST /api/attendance/clock-out                        — clockOut()
POST /api/pos-events/webhook                          — pushEvent()
GET  /api/pos-feed/stores                             — fetchStores()
```

### Méthodes publiques exposées (timewin.service.ts)

- `isHealthy()` — health check
- `loginEmployee()` — auth fallback
- `getEmployeeContext()` — read employee data
- `syncEmployees(storeId)` — bulk read employees per store
- `getTodayShifts(storeId)` — read today's shifts at store
- `getMonthlyPayroll(storeId, month)` — read payroll
- `getStoreSchedule(storeId)` — read schedule
- `updateStoreSchedule(storeId, schedules)` — WRITE schedule back
- `getStoreConfig(storeId)` — read store config
- `clockIn(employeeId, storeId)` — WRITE pointage event
- `clockOut(employeeId, storeId)` — WRITE pointage event
- `pushEvent()` — WRITE arbitrary event
- `fetchStores()` — read all stores

## C.2 — Primitives strate II : présentes ou absentes ? (Q5)

### Q5.1 — `windowOverlap(employee, store, [from, to]) → bool` ?
**Verdict** : **ABSENTE comme primitive nommée.**
```
$ grep -nE "windowOverlap|window_overlap|overlap|shiftOverlap" modules/timewin/timewin.service.ts
(vide)
```
Le pattern d'appel actuel `getTodayShifts(storeId)` retourne un blob, sans paramètre de fenêtre temporelle. /CAISSE devrait filtrer côté lui les shifts pertinents — pas une primitive serveur.

### Q5.2 — `getTodayShifts` est-il temporellement borné par /CAISSE ?
```
async getTodayShifts(storeId: string): Promise<any> {
  return this.fetchWithPosSecret(`/api/pos-feed/today-shifts?storeId=${storeId}`);
}
```
**Verdict** : **Non.** Pas de paramètre `from`/`to`. Le serveur décide ce qu'il retourne (probablement "today" interprété côté serveur). /CAISSE ne contraint pas la fenêtre.

### Q5.3 — `/CAISSE` écrit-il dans TimeWin24 ? (Q5.3)
**Verdict** : **OUI.** Trois écritures :
- `PUT /api/pos-feed/store-schedules` (`updateStoreSchedule`).
- `POST /api/attendance/clock-in` / `clock-out` (pointage POS).
- `POST /api/pos-events/webhook` (events arbitraires via `pushEvent`).

→ /CAISSE n'est pas read-only de TimeWin24. Le pointage POS écrit dans TimeWin24, qui devient autoritatif pour la paie de l'employé. **Surface d'écriture = vecteur d'attaque potentiel** (un compromis /CAISSE peut écrire des pointages frauduleux).

### Q5.4 — Cache local de TimeWin24 ?
**Verdict** : OUI, **TTL 30 minutes** (`cacheTTL = 30 * 60 * 1000`). Ligne 99.
- Mémoire applicative, pas persistance.
- Au-delà de 30 min, refetch.

## C.3 — Auth posture vers TimeWin24 (Q6)

### Mécanismes
Trois variables d'env :
- `TIMEWIN24_API_KEY` — Bearer token (Authorization header), pour endpoints "non-pos".
- `TIMEWIN24_POS_SECRET` — HMAC secret pour endpoints "pos" (`/api/pos-feed`, `/api/pos-events/webhook`).
- `TIMEWIN24_POS_KEY_ID` — identifiant de la clé POS (envoyé en header `X-POS-Key-Id`).

### Pattern de signature des requêtes
```js
// Pour pos-feed / pos-events:
const signature = createHmac('sha256', this.posSecret).update(payload).digest('hex');
headers['X-POS-Signature'] = signature;
headers['X-POS-Key-Id'] = this.posKeyId;

// Pour autres endpoints (auth, attendance):
headers['Authorization'] = `Bearer ${this.apiKey}`;
```
**Verdict** : double auth — HMAC sur les flux POS, Bearer sur les flux génériques.

### Q6.3 — Vérification de la réponse de TimeWin24 (signature retour) ?
**Verdict** : **ABSENTE.**
```
$ grep -nE "verify.*signature|verifyHmac|res\.signature|response\.signature" modules/timewin/timewin.service.ts
(vide)
```
/CAISSE signe ses requêtes vers TimeWin24, mais **n'authentifie PAS les réponses**. Une réponse interceptée ou modifiée en transit (TLS compromis, man-in-the-middle) serait acceptée. **Asymétrie d'auth = trou potentiel**, mais sous TLS sain, c'est la pratique standard.

## C.4 — Résilience et observability (Q7-Q9)

### Circuit breaker
- `cbState ∈ {CLOSED, OPEN, HALF_OPEN}` (ligne 265).
- Seuil de basculement : 3 échecs (`cbThreshold = 3`), reset à `cbResetMs`.
- Alertes : `AlertService.fire('CIRCUIT_BREAKER_OPEN')` sur OPEN.
- `getCircuitState()` exposé pour `/api/health` (le `timewin: 'up'` dans health = breaker CLOSED, pas une vraie santé du service distant — confirmé en session précédente).

### Webhook entrant ?
**Verdict** : aucun endpoint /CAISSE qui reçoit un webhook TimeWin24.
```
$ grep -rln "timewin.*webhook|TimeWin24.*webhook" ...
(aucun)
```
→ Comm unidirectionnelle : /CAISSE → TimeWin24 pour read+write, TimeWin24 → /CAISSE rien. Pas de mécanisme push pour notifier /CAISSE de changements RH côté TimeWin24.

### Fallback / mode dégradé
Pas de mode dégradé applicatif dédié à TimeWin24 :
- Le `loginEmployee` fallback secondaire utilise TimeWin24 seulement si la DB locale ne connaît pas l'employé (et seulement si `POS_AUTH_TIMEWIN_FALLBACK !== 'false'`).
- Quand TimeWin24 est down : circuit ouvert, appels retournent erreur. Les chemins métier (vente, void) ne dépendent **pas** de TimeWin24 (vérifié en session précédente). Donc le POS peut continuer à encaisser même TimeWin24 down — mais le pointage et la paie sont KO.

## C.5 — Threat model TimeWin24 — questions ouvertes

Pour l'audit selon la grille structurelle :

### Q-T1 — Append-only sur TimeWin24 ?
**Non répondable depuis /CAISSE.** Les méthodes consummées (`getTodayShifts`, `getEmployeeContext`, `getMonthlyPayroll`) sont des reads. /CAISSE ne sait pas si TimeWin24 stocke ses événements append-only ou s'ils sont mutables.

### Q-T2 — Hash chain TimeWin24 ?
**Aucune indication.** Aucun champ `hash_chain` ou `prev_hash` dans les réponses TimeWin24 consummées. Pas de structure crypto dans le contrat API.

### Q-T3 — Un admin TimeWin24 peut-il muter un pointage ?
**Inconnu de /CAISSE.** Question pour l'équipe TimeWin24.

### Q-T4 — getTodayShifts sert-il une vue fidèle ou un agrégat recalculable ?
**Inconnu.** Format de réponse non spec'é dans le code /CAISSE (`Promise<any>` partout). Probable que ce soit une liste d'objets shift, mais aucune garantie de fidélité au registre source.

### Q-T5 — Window-overlap primitive — existe-t-elle côté TimeWin24 ?
**Non utilisée actuellement.** /CAISSE ne demande jamais "ce shift a-t-il chevauché [from, to] ?". Soit la primitive existe mais /CAISSE ne l'appelle pas, soit elle n'existe pas. → **Action de découverte pendante** (issue 6).

## C.6 — Verdict global de l'audit read-only

### Ce qui est solide
- Auth bidirectionnelle (HMAC sur POS, Bearer sur générique) côté requête /CAISSE → TimeWin24.
- Circuit breaker en place avec seuil et reset.
- Cache 30 min limite la charge réseau.
- POS résilient : TimeWin24 down ne casse pas la caisse (verified session précédente).

### Ce qui manque pour strate II
- **Window-overlap primitive** : non confirmée chez TimeWin24. Action 6a/6b reste pending.
- **Réponse de TimeWin24 non-authentifiée** : asymétrie côté retour. Sous TLS sain c'est OK, sous TLS compromis c'est un trou.
- **Pas de webhook entrant** : /CAISSE ne peut pas être notifié d'une mutation RH chez TimeWin24 → pas de "alerte si shift modifié post-hoc".

### Le sol non-ouvert que TimeWin24 cache
- Append-only ? Mutable par admin ? Hash-chained ?
- /CAISSE n'a aucun moyen d'auditer ces propriétés depuis sa surface API actuelle.

### Décision recommandée
**Combinaison (6a) + (6b)** :
- **(6a) Audit léger** sur ce que /CAISSE peut auditer : comportement de l'API (latence, format, idempotency des écritures clock-in/clock-out), tests de robustesse contre mutations apparentes.
- **(6b) Déclaration hors-strate** sur ce qui est inauditable depuis /CAISSE : l'intégrité interne de TimeWin24, sa politique de mutation, son ordre événementiel. **Nommer l'assomption** au lieu de prétendre l'avoir vérifiée.
- **Action de découverte (parallèle)** : contacter l'équipe TimeWin24 pour confirmer (Q-T1, Q-T3, Q-T5).

## C.7 — Cohérence avec strate II

Le design strate II suppose :
- B leg = window-overlap → **primitive absente, à confirmer**.
- TimeWin24 inalterable → **non-vérifiable depuis /CAISSE**.
- Pointage /CAISSE → TimeWin24 fait foi pour la paie → **/CAISSE est ÉCRIVAIN dans TimeWin24, pas seulement lecteur** (Q5.3). C'est une nuance : si TimeWin24 est l'autorité de présence pour B, /CAISSE est aussi un client privilégié qui écrit dedans. Threat-model :
  - **Compromis /CAISSE = peut injecter pointages frauduleux dans TimeWin24** → l'autorité de présence est polluée par /CAISSE lui-même.
  - **Auto-validation circulaire** : si A (re-validation backend) confronte à TimeWin24, et que TimeWin24 reflète les pointages écrits par /CAISSE, alors A confronte une source que /CAISSE a écrite. Pas une vérification indépendante.

→ **Découverte : le pattern "TimeWin24 racine de présence" suppose qu'on ne contrôle pas l'écriture vers TimeWin24, mais /CAISSE l'écrit.** À nommer comme dette d'architecture pour le design strate II (issue 6 doit être amendée).

---

## A.4 — Note Railway au moment du merge (déplacé en fin d'annexe A)

---

# ANNEXE B — FAITS Q1/Q2/Q3 (verbatim grep) + SCOPING DÉRIVÉ

Les faits sont rapportés tels que le grep les livre. Le scoping suit, dérivé.

## B.1 — Q1 : La session existe-t-elle en prod ?

### Q1.1 — Entité TypeORM
```
$ ls database/entities/ | grep -iE "session|pos.session|cash.session"
pos-session.entity.ts
```
**Verdict** : entité existe.

### Q1.2 — Migrations qui créent/modifient pos_sessions
```
$ grep -rln "pos_sessions" database/migrations
database/migrations/1710900000000-RemoveRHAddPOSSessions.ts
database/migrations/1700000000000-InitialSchema.ts
```
**Verdict** : table créée par migration `1710900000000-RemoveRHAddPOSSessions`, présente dans `caisse_pos` prod (vérifié en session précédente lors de l'enquête fiscale read-only).

### Q1.3 — Module dédié `pos-session` ?
```
$ find modules -type d 2>/dev/null | grep -iE "pos.session|session"
(aucun module pos-session)
```
**Verdict** : **aucun module métier**.

### Q1.4 — Endpoints openSession/closeSession ?
```
$ grep -rnE "@(Post|Get|Put|Delete|Patch)\(.*session|openSession|closeSession" modules/ --include="*.controller.ts"
modules/inventory-scan/inventory-scan.controller.ts:98:  @Get('session/:sessionId/stats')
```
**Verdict** : seul match = un endpoint inventaire, sans rapport avec POS session. **Pas d'endpoints de lifecycle session POS.**

### Q1.5 — Code applicatif qui INSERT/UPDATE pos_sessions ?
```
$ grep -rnE "PosSessionEntity|posSessionRepo|getRepository.*PosSession|new PosSessionEntity" modules/ --include="*.ts" | grep -v spec
modules/auth/auth.module.ts:10:import { PosSessionEntity } from '../../database/entities/pos-session.entity';
modules/auth/auth.module.ts:30:    TypeOrmModule.forFeature([StoreEntity, EmployeeEntity, PosSessionEntity]),
```
**Verdict** : `auth.module.ts` enregistre `PosSessionEntity` dans `forFeature(...)`, mais **`auth.service.ts` ne le consomme PAS** (vérifié : `grep PosSession modules/auth/auth.service.ts` → vide). **Personne n'insère, personne ne lit.**

### Q1.6 — Intention documentée vs réalité
L'entité elle-même documente :
> *"POS Session — tracks an employee's active register session. Created when employee logs in (via TimeWin24 auth). Closed when employee logs out or session expires."*

**Mais** : Q1.5 prouve qu'aucun code applicatif ne crée la session. **Documentation décrit une intention, pas le réel.**

### Q1 — Verdict consolidé
**Session mi-existante** :
- Niveau **DDL/schéma** : ✓ table créée, entité TypeORM définie, indexes posés.
- Niveau **logique métier** : ✗ aucun module, aucun service, aucun endpoint, aucun INSERT, aucun lifecycle, aucune lecture.

→ **Table prête, jamais peuplée, jamais lue.** Schéma vestigial.

---

## B.2 — Q2 : D'où vient `employee_id` dans `createSale` ?

### Q2.1 — Contrôleur sales : extraction
```
modules/sales/sales.controller.ts:
    34:      req.user.storeId,
    35:      req.user.employeeId,
    36:      dto,
    37:      {
    38:        employeeName: req.user.employeeName,
    39:        employeeRole: req.user.role,
    40:        maxDiscount: req.user.maxDiscount,
    41:      },
```
**Verdict** : `req.user.employeeId` extrait par décorateur `@Request() req` du contrôleur, passé en paramètre positionnel à `salesService.createSale(storeId, employeeId, ...)`.

### Q2.2 — DTO porte-t-il `employee_id` ?
```
$ grep -nE "employeeId|employee_id|operatorId" modules/sales/dto/*.ts
(no matches)
```
**Verdict** : **le DTO body ne porte PAS `employee_id`**. Le client ne peut donc pas l'injecter via la requête. Bonne nouvelle — pire profil de risque écarté.

### Q2.3 — JWT strategy : ce qui peuple `req.user`
```
modules/auth/jwt.strategy.ts:
  async validate(payload: any) {
    const employee = await this.authService.validateEmployee(payload.sub);
    if (!employee) throw new UnauthorizedException();
    return {
      employeeId: payload.sub,
      storeId: payload.storeId,
      role: payload.role,
      employeeName: payload.employeeName,
      maxDiscount: payload.maxDiscount,
    };
  }
```
**Verdict** : `req.user.employeeId = payload.sub` du JWT, où `payload` est le contenu **signé** du token, validé par `JwtStrategy`. Standard JWT — non-falsifiable par le client (sans clé privée). Décodé au guard, sûr cryptographiquement.

### Q2.4 — Login : où `employeeId` entre dans le payload JWT
Dans `auth.service.ts` (login), le payload du JWT signé inclut `sub: empId` où `empId` est l'`employee.id` du compte authentifié par PIN/email. Ligne 60 du log de `audit_entries` : `employeeId: empId`. Le `empId` vient de `loginByPin`/`loginByEmail`, donc de la DB locale.

### Q2 — Verdict consolidé
**`employee_id` = `payload.sub` du JWT signé**, posé au login depuis l'authentification locale (DB).

**Profil de risque** :
- ✓ Pas du body client (non-falsifiable par requête).
- ✓ Signé cryptographiquement (non-falsifiable sans clé).
- ✗ **Mais lié au token, pas à qui-est-au-terminal-maintenant.** Vol/partage de token = vol d'identité. Pas de bind à un événement physique de présence (clock-in, etc.).

**Comparé au scénario "claim arbitraire du body"** : largement meilleur (pas d'exfiltration par body manipulation). **Comparé au scénario "bind à la session physique"** : faible (un même token autorise tous les actes sous l'identité signée, sans re-vérification).

---

## B.3 — Q3 : Lifecycle session enforced ?

### Q3.1 — `createSale` vérifie-t-il `pos_sessions.is_active` ?
```
$ grep -nE "pos_session|posSession|isActive|sessionId" modules/sales/sales.service.ts
(vide)
```
**Verdict** : **`createSale` ne consulte JAMAIS `pos_sessions`.**

### Q3.2 — Guard NestJS qui vérifie la session active ?
```
$ find modules -name "*.guard.ts"
(aucun)
$ grep -rln "PosSession\|isActive\|session" modules/ --include="*.guard.ts"
(aucun)
```
**Verdict** : **aucun guard de session.**

### Q3.3 — `voidSale` vérifie-t-il `pos_sessions` ?
```
$ grep -nE "pos_session|posSession|sessionId|isActive" modules/sales/sales.service.ts | grep -i void
(vide)
```
**Verdict** : `voidSale` non plus.

### Q3 — Verdict consolidé
**Lifecycle session inexistant en pratique.** Schéma posé, mais aucun enforcement runtime : pas de guard, pas de check dans `createSale`/`voidSale`, pas de service de lifecycle, pas d'endpoints. Décoratif au niveau DDL, absent du chemin runtime.

---

## B.4 — Scoping dérivé des trois faits

### Découpage : (1a) primitive session + (1b) binding

**(1a) — Introduire la primitive session POS**
- Créer un module `pos-session` : service + contrôleur.
- Endpoints `POST /sessions/open` (insérer une session active pour terminal+employee) et `POST /sessions/close` (marquer `isActive=false`, poser `closedAt`).
- Service : refuser ouverture si session active existe pour le terminal (lifecycle enforced). Refuser fermeture sans ouverture.
- **Aucun changement à `createSale`/`voidSale`** dans cette PR — la primitive est introduite sans coupler.
- Front aligne pour ouvrir la session à l'arrivée du caissier (PR fillet séparée, après).

**(1b) — Binding**
- Modifier `createSale` (et potentiellement `voidSale`, à voir) pour exiger une session active sur le terminal.
- Lire `employee_id` de la session, pas du JWT.
- Refuser sinon.
- Roll-out après (1a) en prod et exercé Wesley.

### Pourquoi ce découpage (logique blast-radius)

Identique au pattern void/createSale qu'on a tenu :
- (1a) introduit une primitive (étroit, ajouter sans casser).
- (1b) change un invariant runtime (large, blast-radius sur tous les appelants).

Bundlés : si (1b) casse un flow non-mappé → revert → la primitive de (1a) saute avec, et il faut tout repartir.
Découpés : (1a) ship vite, primitive disponible. (1b) itère seul contre la carte réelle des appelants.

### Compatibilité strate II (vigilance ajustement Omar §3)

L'entité actuelle a déjà les champs de la strate II :
- ✓ `store_id`, `employee_id`, `employee_name/role` snapshot — log v1.1 OK.
- ✓ `timewin_session_token` — placeholder pour le token de shift signé.
- ✓ `offline_mode` — flag mode dégradé.
- ✓ `permissions jsonb` — extensible pour `presence_factor`, `authorization_source`, etc.

**Bonne nouvelle** : la primitive (1a) à introduire est **directement compatible** avec le design strate II. Pas de refonte à anticiper. Les champs strate II additionnels (`presence_factor`, `authorization_source`, `pos_session_id` sur `sales`, etc.) seront des migrations additives ultérieures, pas une refonte de l'entité actuelle.

**Cohérent avec ajustement §3 Omar** : pas de session ad-hoc qui devrait être refaite pour strate II.

### Compatibilité runtime actuel : posons LA question critique

`auth.service.ts` ne crée pas de session aujourd'hui. **Quand introduire la session ?** Trois options :

(α) **Login** : auth.service.loginByPin/loginByEmail crée la session avant de signer le JWT. → Session liée au login, durée = token (renouvelée à refresh ?).
(β) **Premier accès POS** : la session est créée par un appel explicite `POST /sessions/open` après le login, du front POS. → Session découplée du login, durée = explicit close.
(γ) **Implicite par terminal** : un endpoint `POST /sessions/open` du contrôleur dédié, où le terminal identifie son `terminal_id` (header dédié, à ajouter).

→ **Ceci est un irréversible-ambigu** : choisir (α) lie session à token (durée courte ?), (β) lie session à acte utilisateur explicite (UX choisi), (γ) demande de poser un `terminal_id` (refactor). Décision avec implications front, sécurité, et flux utilisateur. **À DÉFÉRER**, documenté en §4.

### Décision de découpage (autorisée seul par mandat)

**(1a) primitive session sera implémentée**, avec l'option (β) ou (γ) **NON tranchée** — la primitive sera spec'ée pour être compatible avec les trois options. Concrètement : un endpoint `POST /sessions/open` qui prend l'`employee_id` (du JWT validé), avec un paramètre optionnel `terminal_id` (header `X-Terminal-Id`, falls back si absent). La création est explicite, donc compatible (β) immédiatement, et (γ) si `terminal_id` peuplé.

(α) "auto-créer au login" serait écarté de (1a) — c'est un couplage auth↔session qu'on ne décide pas sans Omar.

---

## A.4 — Note Railway au moment du merge

`caisse_pos` est vide. Railway auto-deploy déclenchera un nouveau build du backend dès le merge. Le déploiement change la sémantique de `voidSale` (rejet 409 sur cash réalisé) sans aucune donnée existante affectée. Fenêtre zéro-risque.

Vérifier dans la dashboard Railway après le merge :
- Build successful.
- Health endpoint OK : `curl https://api.addxintelligence.com/api/health` → `status: ok, db: up, redis: up`.
- Pas de regression sur les endpoints existants.

---
