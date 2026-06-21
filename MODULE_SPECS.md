# MODULE_SPECS.md — spécifications par module

> Détail comportemental des modules **en cours de chantier** (P0/P1 actifs). L'index complet
> des modules + statuts est dans `MASTER_ROADMAP.md` ; l'architecture-of-record + conventions
> dans `CLAUDE.md` ; les specs livrées historiques restent dans leurs docs (`plan.md` = Jackpot/Occupancy).
> On ne duplique pas ici les ~48 modules déjà ✅ ; on spécifie ce qu'on construit/corrige maintenant.

---

## Cluster sécurité P1 (en exécution)

### SPEC M406 — connected-apps : ne plus exposer `api_key`, scoper org
- **Comportement attendu** : les endpoints `GET /connected-apps` et `GET /connected-apps/:id` ne renvoient JAMAIS `api_key` ; ils ne renvoient que les apps de l'organisation de l'appelant ; mutations réservées admin.
- **Implémentation** : `@Exclude()` (class-transformer) sur la colonne `apiKey` de l'entité, OU DTO de réponse omettant le champ ; filtrer findAll/findOne par `req.user.organizationId` ; `@Roles` sur les routes sensibles.
- **Critères** : tsc vert ; un caissier ne voit pas `api_key` ni les apps d'une autre org ; test contrôleur.

### SPEC M203/M208 — Tenant : garder les GET org/units/stores
- **Attendu** : `GET /organizations`, `GET /units`, `GET /stores` (list) exigent `@Roles('admin')` (ou scoping org pour non-admin) ; un caissier ne lit pas le graphe multi-tenant.
- **Implémentation** : ajouter `@Roles('admin')` sur les list-handlers (le RolesGuard est déjà au niveau contrôleur ailleurs) ; vérifier qu'aucun flux POS légitime ne dépend de ces list non-gardés (sinon scoper au lieu de bloquer).
- **Critères** : tsc vert + suite verte ; appel caissier → 403 ; admin → 200.

### SPEC M301 / D12 — customers : ne plus renvoyer `otpCode`
- **Attendu** : `POST /customers` renvoie `{ customer, qrCodeDataUrl }` sans `otpCode`. L'OTP reste loggé en dev uniquement.
- **Critères** : réponse sans champ `otpCode` ; flux de vérification OTP inchangé ; test.

### SPEC M403 / D5 — sync push : scoper storeId
- **Attendu** : `POST /sync/push` résout le storeId comme pull/status (depuis `req.user`) et rejette/écrase un `payload.storeId` divergent ⇒ un device ne peut écrire que dans son magasin.
- **Critères** : tsc vert ; push avec storeId étranger → refus ou réécriture ; test.

---

## Cluster correctness P1 (planifié)

### SPEC M005 — sales DTO : tender store_credit
- Ajouter `'store_credit'` à `SalePaymentDto.method @IsIn`; ajouter `@IsOptional() @IsString() creditNoteCode?`. Test contrôleur POSTant un leg store_credit de bout en bout.

### SPEC M006 / M402 (D3/D4) — verifyChain recompute + anti-fork
- `verifyChain` recalcule `currentHash` depuis les champs stockés et compare au stocké ; persister le payload canonique (timestamp ISO inclus) ; migration : index unique `(store_id, previous_hash)`. Specs : chaîne saine OK ; ligne `details` falsifiée → mismatch ; lien forké → rejet.

### SPEC M107 / D11 — source unique stock
- Décider : soit router les ventes magasin via stock-locations (décrément balance + mouvement 'sale'), soit garder la colonne legacy autoritative et empêcher syncLegacyStock de l'écraser. Documenter. `CHECK (quantity >= 0)` sur `stock_balances`. Specs transfer/dispatch/recordLoss/insufficient + syncLegacyStock.

### SPEC M108 — réconciliation stock (decision 7)
- Spec : écart 19 % applique directement ; 20 % et 21 % → `pending_review` (pas de correction auto) ; `confirmCorrection` exige une raison ∈ {casse,vol,erreur_inventaire,perte,perime,autre} ; `reject` ne modifie pas le stock.

### SPEC M302 / D13 — RGPD effacement client
- `anonymizeCustomer(id)` : scrub PII (nom/email/téléphone → null/placeholder), `anonymizedAt` set ; soft-delete `deletedAt` ; endpoint admin audité ; (P2) export portabilité.

### SPEC M704 — customer-app deps
- `npm install` racine pour résoudre `@capacitor/preferences@^6` (+`app`,`push-notifications` OU retirer push si non importé). tsc `packages/customer-app` → 0 erreur. Pas de changement code.

### SPEC M601 — POS complétion TPE
- Câbler `useStripeTerminal.collectPayment` dans `startTpeWaiting('card')` → résultat lecteur appelle `handleTpeResponse('success'|'refused')` ; OU bouton caissier explicite dans l'overlay d'attente (modèle TPE autonome). Un seul modèle, documenté. Test branche succès.

### SPEC M603 — POS offline creditNoteCode
- Inclure `creditNoteCode` (et métadonnées voucher/gift) dans le payload d'enqueue offline pour que les redemptions store_credit survivent à la resync. Tests finalize (online-success / network→queue / 4xx→SALE_ERROR sans vider le panier).
