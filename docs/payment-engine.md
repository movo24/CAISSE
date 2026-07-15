# Payment Engine universel — Audit & Architecture

> Statut : **ARCHITECTURE VALIDÉE PAR L'OWNER (arbitrages D-PE1..D-PE6 + GlobalPaymentId
> intégrés, §6) — document seul, aucune implémentation** (GO owner explicite requis avant tout code).
> Date : 2026-07-14 · Base : `main@e82427a` (v1.1.0)
> Règle centrale ratifiée par l'owner : **un paiement au résultat incertain ne repart JAMAIS
> comme un nouveau paiement — il passe en vérification/réconciliation. Zéro double débit.**
> Identifiant de référence unique du moteur : **`GlobalPaymentId`**, créé par ADDX **avant tout
> échange avec le fournisseur** — les références PSP (PaymentIntent Stripe, référence CIC,
> PSP Reference Adyen, Worldline Transaction ID…) s'y rattachent, jamais l'inverse.

---

## 1. Objectif

ADDX abandonne toute dépendance à un prestataire unique. Le POS doit intégrer un
**Payment Engine universel** : n'importe quel TPE / fournisseur (CIC/Monetico, Worldline,
Adyen, Stripe Terminal, Ingenico, Verifone, PAX, Nexi, Yavin, SumUp, futurs partenaires…)
se branche par un **connecteur** qui implémente une interface unique, sans modifier le
reste du logiciel. Le fournisseur se choisit **par configuration, par magasin et par
terminal** — jamais par recompilation.

---

## 2. Audit de l'existant (2026-07-14)

Fournisseur unique en place : **Stripe Terminal** (WisePad 3 / M2 / S700). Tout est câblé
en dur. Deux pipelines POS dupliqués. Synthèse avec références `fichier:ligne`.

### 2.1 Ce qui est DÉJÀ FIABLE (à conserver tel quel ou à généraliser)

| Acquis | Où | Pourquoi c'est solide |
|---|---|---|
| **Vérification de capture côté serveur** avant de marquer une vente payée | `sales.service.ts:209-271` (`verifyCardCaptureClaims`, appelé `:662`) | Matrice d'échec complète : PI introuvable → vente REFUSÉE ; PI d'un autre magasin → REFUSÉE ; statut ≠ succeeded → REFUSÉE ; montant insuffisant → REFUSÉE ; panne Stripe/réseau → dégradé `pendingCapture` (jamais « payé ») |
| **Invariant « jamais payé si non capturé »** | POS : `usePayment.ts:405-410`, `POSPage.tsx:726-730` ; serveur : `sale.status='payment_pending'` (`sales.service.ts:802-804`), `captured/capturedAt` (`sale-payment.entity`, migration 1743) | Une jambe carte sans preuve de capture ne finalise jamais la vente comme payée |
| **File de régularisation** | `listPendingPayments` (`sales.service.ts:1315`), `regularizePayment` (`:1329-1368`), alerte `PAYMENT_PENDING_CAPTURE`, audit `payment_capture_failed` | Le dégradé a un chemin de sortie tracé |
| **Idempotence de création de vente** | `IdempotencyKeyEntity` (TTL 7 j), header `Idempotency-Key`, re-check DANS la transaction + insert atomique (`sales.service.ts:338-350, 677-685, 930-938`) ; clé POS unique par checkout réutilisée sur retry/offline (`usePayment.ts:198-255`, `syncEngine.ts:135-149`) | Un replay réseau/offline ne crée jamais deux ventes |
| **Clé d'idempotence Stripe déterministe côté serveur** | `stripe-terminal.service.ts:52-54,70` (SHA-256 `store:ticket:amount:currency:employee`) | Le backend dédoublonne la création de PaymentIntent |
| **Machine de tender pure** (répartition cash/carte/avoir, rendu, trop-perçu forfait) | `paymentMachine.ts` (+ tests) | Déjà agnostique fournisseur — devient le socle du moteur |
| **Fail-closed carte** | `cardPaymentMode.ts:44-53` (statut backend injoignable → carte désactivée en prod) | Bon réflexe sécurité, à généraliser |
| **Journal fiscal / audit** | hash-chain v2 des ventes (paiements dans l'empreinte, `sales.service.ts:720-745`), `audit_entry` (`sale_completed`, `payment_pending`, `payment_regularized`, `payment_capture_failed`), outbox `payment.captured` | Base append-only saine à enrichir |

### 2.2 Ce qui est SPÉCIFIQUE STRIPE (à isoler derrière l'interface)

| Couplage | Où |
|---|---|
| SDK `@stripe/terminal-js` importé dans le renderer | `useStripeTerminal.ts:15,156-316` (create/discover/collect/process) |
| Séquence PI card-present, `capture_method:'automatic'` figé | `stripe-terminal.service.ts:39-78` |
| Capacité carte définie comme « Stripe configuré » | `cardPaymentMode.ts:13,40-53` |
| Champs Stripe dans le domaine : `stripePaymentIntentId`, `stripeReaderId` | `sale-payment.entity.ts:26-30`, `sales.dto.ts:42-47`, `salePayload.ts:11-36`, `usePayment.ts:23-24`, file offline |
| Vérification de capture appelant `stripe.paymentIntents.retrieve` en direct | `sales.service.ts:234-266` |
| Registre terminaux mono-fournisseur : enum `TerminalProvider = { STRIPE }`, `deviceType` = modèles Stripe, `stripeReaderId/LocationId` | `payment-terminal.entity.ts:14-63` |
| Clé Stripe globale d'environnement (`STRIPE_SECRET_KEY`), aucune config par magasin | `store.entity.ts` (0 colonne provider) |

### 2.3 Ce qui doit être DÉCOUPLÉ / CORRIGÉ (écarts et trous)

1. **Deux pipelines TPE dupliqués et divergents** : `usePayment.ts` (iPad, seul capable du mode
   `real`) vs ré-implémentation inline `POSPage.tsx:670-1066` (desktop, mode `real` interdit
   `POSPage.tsx:692-695`). Garanties différentes : garde de ré-entrée synchrone `finalizingRef`
   présente côté POSPage (`:191,836-837`), **absente** côté `usePayment`.
2. **Aucune reprise après crash/redémarrage pendant un paiement** : état TPE 100 % en mémoire
   React ; un PaymentIntent collecté dont la vente n'est pas créée devient **orphelin** —
   `getPaymentIntent`/`cancelPaymentIntent` existent côté API mais ne sont **jamais appelés**
   par le renderer. Pas de rapprochement.
3. **Clé d'idempotence PI non déterministe côté POS** : `useStripeTerminal.ts:41-42,261`
   (`pi_<tn>_<Date.now()>_<random>`) — un retry produit une clé différente (la dédup ne tient
   que par le backend).
4. **Remboursement carte purement déclaratif** : `refundMethod:'card'` n'appelle aucun PSP
   (`returns.service.ts` — zéro `refunds.create`) ; l'opérateur rembourse sur le TPE hors
   système, sans trace de l'ID de remboursement fournisseur.
5. **Pas d'idempotence serveur sur la régularisation** : `regularizePayment` (`:1329-1368`)
   n'écrit pas d'`IdempotencyKey` (seule garde : le statut).
6. **Table `payment_terminals` sans migration** (entité seule) — risque prod.
7. **Aucun webhook entrant normalisé** (payment.succeeded/failed/refunded par provider).
8. **Aucune config terminal persistée côté POS** : auto-connexion `readers[0]`
   (`usePayment.ts:437-440`), pas d'IP/port/serial mémorisés ; heartbeat inopérant sur le
   pipeline principal (`dbTerminalId` non transmis).
9. **Journal de paiement local inexistant** : pas d'horodatage début/fin collecte, réf PI,
   lecteur, durée, code refus, tentatives — inutilisable pour un litige.
10. **Statuts éclatés** : 3 mini-machines (`tpeResult`, `TerminalStatus`, `CardPaymentMode`)
    + booléens, aucun enum unifié de cycle de vie du paiement.
11. **`sale_payments` sans champs neutres** : pas de `provider`, `authorizationCode`,
    `acquirerRRN`, `providerMetadata`.

### 2.4 Risques classés par criticité

| # | Criticité | Risque | Source |
|---|---|---|---|
| R1 | **CRITIQUE** | **Débit client sans vente** (PI orphelin) : crash/rechargement entre la réponse TPE et la création de vente → client débité, aucune vente, aucun rapprochement automatique | Écart 2 |
| R2 | **CRITIQUE** | **Double débit potentiel en re-tentative manuelle** après résultat incertain (timeout/communication perdue) : rien n'empêche le caissier de relancer un paiement complet alors que le premier a peut-être abouti | Écarts 2-3 ; règle owner |
| R3 | **HAUTE** | Double finalisation locale possible côté iPad (pas de verrou synchrone dans `usePayment`) — aujourd'hui rattrapée uniquement par l'idempotence backend | Écart 1 |
| R4 | **HAUTE** | Remboursement carte non piloté : risque d'avoir émis SANS remboursement TPE réel (ou l'inverse), aucun ID de remboursement tracé | Écart 4 |
| R5 | **HAUTE** | Divergence des deux pipelines (bug corrigé d'un côté, pas de l'autre) | Écart 1 |
| R6 | **MOYENNE** | Rejeu de régularisation non idempotent (double `payment_regularized` possible en théorie) | Écart 5 |
| R7 | **MOYENNE** | `payment_terminals` sans migration → table absente en prod si `synchronize=false` | Écart 6 |
| R8 | **MOYENNE** | Observabilité paiement insuffisante (litiges, réconciliation acquéreur impossible depuis la caisse) | Écarts 9-11 |
| R9 | **BASSE** | Mode `real` interdit sur desktop (couplage plateforme↔fournisseur arbitraire) | `POSPage.tsx:692-695` |

---

## 3. Architecture cible

### 3.1 Vue d'ensemble

```
                    ┌────────────────────────────────────────────┐
   POS (renderer)   │              PaymentEngine                 │   1 seul moteur,
   ────────────────►│  · machine à états canonique               │   consommé par
   UI caissier      │  · idempotence / anti-double-débit         │   POSPage ET iPad
   (états → msgs)   │  · persistance des tentatives (reprise)    │   (fin des 2 pipelines)
                    │  · journal append-only                     │
                    └───────────────┬────────────────────────────┘
                                    │ interface unique
                    ┌───────────────▼────────────────────────────┐
                    │            PaymentProvider                 │
                    ├────────────────────────────────────────────┤
                    │ StripeProvider · CICProvider · Worldline…  │
                    │ ManualProvider · MockProvider              │
                    └───────────────┬────────────────────────────┘
                                    │
   Backend          ┌───────────────▼────────────────────────────┐
   ────────────────►│  ProviderRegistry (config magasin/terminal)│
                    │  Vérification de capture via provider      │
                    │  Réconciliation + webhooks normalisés      │
                    └────────────────────────────────────────────┘
```

Le reste d'ADDX (vente, ticket, fiscal, stock, sync) **ne connaît jamais** le fournisseur :
il parle au `PaymentEngine`, qui parle à un `PaymentProvider`. Interdiction structurelle de
`if stripe` / `if cic` hors du dossier du connecteur concerné (règle lint dédiée).

### 3.2 Interface commune `PaymentProvider`

```typescript
/** Contrat unique — chaque connecteur l'implémente intégralement.
 *  Capacités matérielles variables → déclarées via `capabilities`. */
export interface PaymentProvider {
  readonly name: string;                        // 'stripe' | 'cic' | 'worldline' | 'manual' | 'mock' | …

  /** Ce que le matériel/fournisseur sait faire (le moteur adapte l'UX/le flux). */
  capabilities(): ProviderCapabilities;         // { refund, cancel, statusQuery, separateAuthCapture, … }

  /** Cycle de vie connexion. */
  init(config: TerminalConfig): Promise<void>;  // config = jamais de secret en dur
  connect(): Promise<void>;
  disconnect(): Promise<void>;                  // fermeture propre
  healthcheck(): Promise<ProviderHealth>;       // test de communication + diagnostic
  reconnect(): Promise<void>;

  /** Paiement. `attempt` porte TOUTES les clés (voir 3.5) — le provider n'en génère aucune. */
  collect(attempt: PaymentAttempt): Promise<ProviderResult>;
  cancel(attemptId: string): Promise<ProviderResult>;          // annulation avant/pendant présentation carte

  /** Post-transaction. */
  getStatus(providerRef: string): Promise<ProviderTxStatus>;   // consultation du statut (réconciliation)
  refund(req: RefundRequest): Promise<ProviderResult>;         // remboursement référencé COMPLET (D-PE3 ; jamais « aveugle », partiels plus tard)

  /** Références restituées : toujours normalisées. */
  // ProviderResult = { outcome, providerRef, authorizationCode?, acquirerRRN?,
  //                    maskedPan?, scheme?, errorCode?, raw?: metadata non sensible }
}
```

Connecteurs prévus : `StripeProvider` (extraction de l'existant), `MockProvider`
(remplace le mode `demo` actuel), `ManualProvider` (TPE 4G autonome / secours : le caissier
confirme un paiement réalisé hors système → toujours `pendingCapture`, régularisation
obligatoire), puis `CICProvider` / `WorldlineProvider` / `AdyenProvider` / … selon le
partenaire retenu. **Aucune limite de liste.**

Réseau : le moteur ne fait **aucune hypothèse** — Ethernet, Wi-Fi, USB, série, Bluetooth,
API cloud sont des détails du connecteur (`TerminalConfig.connection: { type, address?, port?, … }`).

### 3.3 Statuts canoniques et transitions autorisées

```
CREATED ──► PAYMENT_PENDING ──► WAITING_FOR_CUSTOMER ──► WAITING_FOR_CARD ──► AUTHORIZING
                │                        │                      │                  │
                │                        ├──► CANCELLED ◄───────┤                  ├──► APPROVED
                │                        │   (annulation caisse)│                  ├──► DECLINED
                │                        │                      │                  │
                └──► COMMUNICATION_ERROR ◄──────────────────────┴──────────────────┤
                          │                                                        │
                          ▼                                                        ▼
                       UNKNOWN ◄───────────────── TIMEOUT ─────────────────────────┘
                          │
                          ▼
                 VERIFICATION_REQUIRED ──► (getStatus / réconciliation) ──► APPROVED | DECLINED | CANCELLED

APPROVED ──► REFUND_PENDING ──► REFUNDED | REFUND_FAILED
```

Règles de transition **dures** (appliquées par le moteur, pas par les connecteurs) :

- `TIMEOUT`, `COMMUNICATION_ERROR`, `UNKNOWN` → transition **unique** possible :
  `VERIFICATION_REQUIRED`. **Jamais** vers un nouveau `collect()` de la même tentative,
  et la vente ne peut pas créer une NOUVELLE tentative tant qu'une tentative du même
  `SaleId` est en `VERIFICATION_REQUIRED` non résolue. → **zéro double débit structurel.**
- `APPROVED` est **terminal côté encaissement** : seule la voie `REFUND_*` en sort.
- Toute transition est journalisée (append-only, cf. 3.9) avec horodatage + acteur.
- La vente n'est finalisée « payée » qu'après `APPROVED` **et** la re-validation serveur
  (capture prouvée) — l'invariant existant `verifyCardCaptureClaims` est conservé et
  routé via `provider.getStatus()`.

### 3.4 Attempt / Authorization / Capture / Refund / Settlement

| Concept | Définition | Porté par |
|---|---|---|
| **Payment Attempt** | UNE présentation de paiement au client (id unique, clés d'idempotence). Une vente peut avoir plusieurs attempts (split, échec puis retry EXPLICITE) mais jamais deux actives | `payment_attempts` (nouvelle table) |
| **Authorization** | Accord d'autorisation de l'émetteur (n° d'autorisation) — peut exister sans capture | `authorizationCode` sur l'attempt |
| **Capture** | Débit effectif. Selon provider : automatique (Stripe actuel) ou séparée (`separateAuthCapture`) | `captured/capturedAt` (existant, conservé) |
| **Refund** | Opération référencée sur une transaction capturée (`provider.refund(txRef)`), jamais un paiement négatif aveugle | états `REFUND_*` + avoir existant |
| **Settlement** | Versement acquéreur (J+n) — hors temps réel caisse ; rapproché a posteriori via `acquirerRRN`/rapports | réconciliation backoffice (phase ultérieure) |

### 3.5 Idempotence & anti-double-débit

Chaque tentative porte, générés par le MOTEUR (jamais par le connecteur — corrige
`useStripeTerminal.ts:41-42`) :

```
GlobalPaymentId    (uuid ADDX, créé AVANT tout échange fournisseur — identifiant de
                    référence unique dans tout le moteur, les journaux, les entités
                    et les échanges POS↔backend ; ne change jamais)
PaymentAttemptId   (uuid, stable pour toute la vie de la tentative)
IdempotencyKey     (déterministe : dérivée de PaymentAttemptId — identique sur tout retry technique)
StoreId · TerminalId · CashSessionId · SaleId
```

**Rattachement des références fournisseur** : chaque connecteur enregistre ses propres
références (Stripe PaymentIntent, référence CIC, PSP Reference Adyen, Worldline
Transaction ID…) SOUS le `GlobalPaymentId` (table de correspondance
`payment_provider_refs(global_payment_id, provider, ref_type, ref_value)`), jamais
l'inverse. Le moteur, la réconciliation, le journal et les entités de vente ne
raisonnent QUE en `GlobalPaymentId` — aucune dépendance aux identifiants du prestataire.

Protections cumulées :

1. **Verrou de ré-entrée synchrone** dans le moteur (généralisation du `finalizingRef` de
   POSPage — corrige l'écart R3) : double clic/double envoi impossibles localement.
2. **Une seule tentative active par SaleId** (contrainte moteur + contrainte d'unicité DB
   partielle sur `payment_attempts (sale_id) WHERE status IN (états actifs)`).
3. **Clé déterministe transmise au provider** : un retry technique du même attempt est
   dédupliqué par le PSP.
4. **Idempotence serveur étendue** à la régularisation et au remboursement (comble R6) —
   même mécanisme `IdempotencyKeyEntity` que la création de vente.
5. **Règle owner (supreme)** : résultat incertain → `VERIFICATION_REQUIRED`, jamais de
   relance automatique. La relance N'EST possible qu'après résolution (statut PSP consulté)
   et crée une NOUVELLE tentative explicite, tracée.

### 3.6 Configuration fournisseur par magasin et par terminal

- `stores.payment_provider` (varchar, nullable = hérite du défaut plateforme).
- `payment_terminals` généralisée : `provider` (varchar ouvert, plus d'enum mono-valeur),
  `device_model`, `serial_number`, `connection` (jsonb : type, ip, port, bt, cloud…),
  `provider_config` (jsonb NON sensible : merchant-id, location-id…), `timeout_ms`,
  `label`, `status`, `is_active`. **+ migration réelle** (comble R7 — la table n'en a pas).
- Secrets (clés API par magasin/fournisseur) : **jamais en DB en clair ni dans le repo** —
  variables d'environnement/secret-store côté backend, référencées par nom dans la config.
- Changement de fournisseur = mise à jour de configuration + rechargement du registre.
  **Aucune recompilation.** `Store 1 → CIC, Store 2 → Worldline, Store 3 → Adyen` doit être
  un simple état de données.
- Côté backend : `ProviderRegistry` résout `(storeId, terminalId) → PaymentProvider` ;
  côté POS : le moteur reçoit la config du terminal enrôlé (réutilise l'enrôlement machine
  existant, Partie B).

### 3.7 Modes de fonctionnement

| Mode | Connecteur | Règle |
|---|---|---|
| **Piloté** (Stripe Terminal aujourd'hui, CIC/Worldline/… demain) | provider réel | Flux 3.3 complet, capture prouvée avant « payé » |
| **TPE 4G autonome** (terminal non connecté au POS) | `ManualProvider` | Le caissier saisit le résultat → la jambe carte est TOUJOURS `pendingCapture` → vente `payment_pending` → régularisation backoffice (mécanisme existant conservé) |
| **Manuel / secours** (panne provider, panne réseau) | `ManualProvider` | Identique — la vente n'est jamais bloquée, mais jamais marquée payée sans preuve |
| **Démo / dev** | `MockProvider` | Remplace le mode `demo` actuel ; simulation des états, y compris TIMEOUT/UNKNOWN pour les tests |

Le fail-closed actuel est conservé et généralisé : aucun provider actif joignable → carte
désactivée (`disabled`), espèces/avoirs restent disponibles.

### 3.8 Coupure réseau, réponse incertaine, reprise & réconciliation

- **Persistance locale des tentatives** (corrige R1) : chaque attempt est écrit dans un
  journal local **IndexedDB** (D-PE2 ratifié) **avant** l'envoi au terminal, mis à jour à
  chaque transition. Au démarrage, le moteur relit les attempts non terminaux →
  `VERIFICATION_REQUIRED` → `provider.getStatus(providerRef)` → résolution :
  - PSP dit APPROVED et la vente n'existe plus → **aucune recréation automatique**
    (D-PE5 ratifié) : l'attempt reste en `VERIFICATION_REQUIRED`, alerte visible, et un
    **responsable** décide — rattacher le paiement à une vente existante · recréer la
    vente · ou rembourser — chaque décision tracée (acteur + motif) ;
  - PSP dit DECLINED/CANCELLED/inexistant → tentative close, la vente peut être re-tentée ;
  - PSP injoignable → l'attempt reste en vérification, alerte visible, JAMAIS de relance.
- **Réconciliation serveur automatique** : job périodique backend qui balaie
  (a) les ventes `payment_pending`, (b) les attempts `VERIFICATION_REQUIRED` remontés par
  les caisses, (c) les webhooks reçus — et converge vers un état prouvé. Alerte
  `PAYMENT_PENDING_CAPTURE` existante conservée.
- **Webhooks normalisés** (nouveau, comble l'écart 7 serveur) : endpoint par provider →
  traduction en événements canoniques (`payment.approved/declined/refunded`), idempotents.

### 3.9 Journal d'audit append-only

Chaque tentative journalise (POS local + backend, append-only, jamais UPDATE/DELETE —
même discipline que `audit_entry`) :

`globalPaymentId · attemptId · saleId · storeId · terminalId · cashSessionId · provider ·
montant · devise · heure d'envoi · heure de réponse · durée · transition (from→to) ·
résultat · providerRef · authorizationCode · acquirerRRN · code erreur ·
acteur (caissier/système)`

Le `fiscal_journal` reste inchangé (NF525) ; le journal de paiement est un journal
technique complémentaire, rattaché à la vente par `saleId`.

### 3.10 Données sensibles — interdictions absolues (PCI DSS)

**Jamais stockées, jamais loggées, nulle part (POS, backend, journaux, raw provider)** :
PAN complet, piste magnétique, CVV/CVC, PIN, données EMV brutes, contenu des tokens de
session PSP. Autorisés : PAN masqué (`**** 1234`), réseau carte (scheme), n° d'autorisation,
références de transaction PSP, RRN. Le champ `raw` des résultats provider est filtré par
une allowlist avant persistance. Les secrets de configuration ne transitent jamais par le
renderer.

### 3.11 UX caissier — états → messages (identique quel que soit le fournisseur)

| État moteur | Message affiché |
|---|---|
| `CREATED`/`PAYMENT_PENDING` | « Paiement par carte » |
| connexion provider | « Connexion au terminal » |
| envoi montant | « Envoi du montant » |
| `WAITING_FOR_CUSTOMER`/`WAITING_FOR_CARD` | « Présentez votre carte » |
| `AUTHORIZING` | « Paiement en cours » |
| `APPROVED` | « Paiement accepté » |
| `DECLINED` | « Paiement refusé » |
| `COMMUNICATION_ERROR`/`TIMEOUT` | « Communication perdue » |
| `UNKNOWN`/`VERIFICATION_REQUIRED` | « Vérification nécessaire » (+ blocage de relance, consigne claire) |

Le nom du fournisseur n'apparaît jamais dans le parcours d'encaissement. Un seul overlay
TPE partagé POSPage/iPad (fin de la duplication R5), branché sur les états du moteur.

### 3.12 Compatibilité future

- Multi-acquéreurs : `global_payment_id` + `provider` + `providerRef`/`acquirerRRN` neutres
  dans `sale_payments` (ajout de colonnes ; les colonnes `stripe_*` existantes sont
  conservées puis migrées vers les champs neutres — aucune réécriture d'historique).
  Le `GlobalPaymentId` est la clé de jonction unique entre vente, tentative, journal,
  références PSP et rapports acquéreur.
- Multi-modèles de TPE : `device_model` libre + `capabilities()` par connecteur (un TPE sans
  remboursement piloté → le moteur bascule sur le flux avoir/manuel).
- Auth/capture séparées : supportées par le flux (3.4) dès qu'un provider le permet
  (`separateAuthCapture`), sans changement du reste du logiciel.

---

## 4. Plan de migration sans interruption de service

Chaque phase est livrable, testée, réversible, sans changement de comportement pour les
magasins tant que la config ne change pas.

1. **P0 — Socle types & contrats** (aucun runtime) : interfaces `PaymentProvider`,
   `PaymentAttempt`, états canoniques, mapping des états existants → canoniques. Tests purs.
2. **P1 — Extraction `StripeProvider` + `MockProvider`** derrière l'interface, moteur
   consommé par le pipeline iPad puis par POSPage (suppression du pipeline inline dupliqué).
   Comportement identique prouvé (mêmes cas de test que l'existant + parité des invariants).
3. **P2 — Persistance des tentatives + reprise + `VERIFICATION_REQUIRED`** (corrige R1/R2) ;
   utilisation de `getPaymentIntent` pour la résolution ; journal de paiement local.
4. **P3 — Backend générique** : colonnes neutres `sale_payments` (+ migration), migration
   `payment_terminals` (provider varchar, connection jsonb), `stores.payment_provider`,
   `ProviderRegistry`, `verifyCardCaptureClaims` routé via provider, idempotence sur
   régularisation, webhooks normalisés, réconciliation périodique.
5. **P4 — Remboursement piloté** : `provider.refund()` branché sur le flux avoir existant
   (quand `capabilities().refund` = true), ID de remboursement tracé (corrige R4).
6. **P5 — 2e connecteur réel** (partenaire retenu : CIC/Monetico, Worldline, Adyen…) —
   preuve finale d'universalité : aucun changement hors du dossier du connecteur + config.

Migrations DB : **additives uniquement**, jamais de rewrite des ventes existantes (NF525).
Toute migration touchant `sales/payments` = **Tier-2 → GO owner explicite préalable.**

## 5. Tests & preuves exigés avant activation en production

- Tests unitaires de la machine à états : **toutes** les transitions autorisées + rejet de
  toutes les transitions interdites (dont `UNKNOWN → collect`).
- Tests d'idempotence : double clic, double envoi, replay offline, rejeu de régularisation,
  rejeu de webhook — zéro duplication (ventes, paiements, remboursements).
- Tests de reprise : kill du POS à CHAQUE état de la machine → au redémarrage l'attempt
  converge sans double débit (MockProvider scriptable : APPROVED tardif, DECLINED, silence).
- Parité Stripe : suite existante verte inchangée (`verifyCardCaptureClaims` matrice
  complète, `paymentMachine`, capture/pending/régularisation).
- Test d'universalité : `MockProvider` + `StripeProvider` interchangeables par config sans
  recompilation ; grep CI interdisant `stripe` hors `providers/stripe/` (et idem par provider).
- Preuve terrain avant GO prod : scénario complet sur TPE réel en magasin pilote
  (paiement, refus, annulation, timeout avec vérification, remboursement, coupure réseau).

## 6. Arbitrages owner — **RATIFIÉS** (2026-07-14)

L'owner a validé les orientations avec les décisions suivantes, désormais **normatives** :

| # | Décision ratifiée |
|---|---|
| D-PE1 | **Aucun fournisseur figé maintenant.** Premier connecteur réel = celui du prestataire effectivement retenu (CIC, Adyen, Worldline ou autre). Le Payment Engine reste totalement indépendant. |
| D-PE2 | **IndexedDB** pour la persistance locale des tentatives (robuste, adapté à Electron, plus simple à maintenir qu'un format de fichier propriétaire). |
| D-PE3 | **Remboursement référencé COMPLET uniquement** au départ. Les remboursements partiels arriveront plus tard. |
| D-PE4 | **Configuration par magasin avec surcharge possible par terminal** (ex. : Magasin A → CIC, Magasin B → Adyen ; une caisse spécifique du magasin A peut utiliser un autre provider en cas de besoin). |
| D-PE5 | **Aucune recréation automatique de vente.** Paiement approuvé sans vente correspondante → `VERIFICATION_REQUIRED`, puis **décision d'un responsable** : rattacher le paiement à une vente existante · recréer la vente · ou rembourser. Intervention humaine obligatoire. |
| D-PE6 | **Webhooks lorsqu'ils existent + réconciliation périodique (cron).** Les webhooks peuvent être perdus ou retardés ; la réconciliation est le filet de sécurité. |
| + | **`GlobalPaymentId`** : identifiant universel de transaction interne, créé par ADDX avant tout échange fournisseur ; toutes les références PSP s'y rattachent (§3.5). Identifiant de référence dans tout le moteur. |

**Principe fondamental ratifié par l'owner** (GO merge #82, 2026-07-14) :
> Le Payment Engine doit rester indépendant de tout fournisseur. **L'ajout ou le
> remplacement d'un PSP ne devra jamais nécessiter de modification de la logique
> métier de la caisse.**

**Séquencement ratifié** : cette architecture est la **référence officielle** du Payment
Engine. Le GO d'implémentation (P0/P1) n'est **pas** donné : il sera donné explicitement
une fois le premier partenaire monétique arrêté (échanges techniques et contractuels en
cours — CIC probable, non figé). Aucun développement du Payment Engine ne doit commencer
avant ce GO explicite ; l'implémentation conservera exactement cette architecture.

## 7. Checklist de conformité AVANT le lancement de P0/P1 (owner)

À re-vérifier formellement au moment du GO d'implémentation — chaque point doit être
prouvable par lecture du code livré :

1. **Interface 100 % générique** : `PaymentProvider` ne contient aucune notion propre à
   Stripe, CIC, Adyen, Worldline ou autre — toutes les méthodes restent génériques
   (gardé par la règle lint anti-`if <psp>` hors du dossier du connecteur, §3.1/§5).
2. **`GlobalPaymentId` maître** : identifiant utilisé par toute la caisse ; les références
   PSP ne sont QUE des correspondances (`payment_provider_refs`, §3.5).
3. **Statuts génériques** : les statuts canoniques (§3.3) couvrent tous les PSP (autorisé,
   en attente, capturé, annulé, remboursé, échec, inconnu…) sans dépendre de la
   terminologie d'un fournisseur — chaque connecteur mappe SES états vers le canon,
   jamais l'inverse.
4. **Remboursements entièrement référencés** : jamais de crédit aveugle — aucun risque de
   double remboursement ni de désynchronisation (D-PE3, idempotence §3.5.4).
5. **Dépendance à sens unique** : toute la logique métier (vente, clôture de caisse,
   statistiques, fiscalité, stock, journal) dépend du Payment Engine, **jamais**
   directement du SDK d'un PSP.

## 8. Grille d'évaluation des candidats PSP (owner)

Démonstration exigée de CHAQUE candidat (CIC/Monetico, Worldline, Adyen ou autre) sur une
base commune — l'interface §3.2 sert de cahier des charges :

1. Paiement TPE intégré (Windows/Electron).
2. Paiement sans contact (Apple Pay, Google Pay si pertinent).
3. Webhooks fiables avec reprise en cas de perte réseau.
4. Remboursement référencé.
5. Idempotence.
6. Temps moyen de transaction.
7. Fonctionnement hors connexion et reprise.
8. Disponibilité d'un environnement de test.
9. Support technique et SLA.
10. Coût complet (commission, location TPE, frais fixes, frais de remboursement…).

Rien n'est figé — même avec un favori (CIC) — avant les spécifications techniques ET le
contrat. L'architecture permet de comparer les prestataires sans redessiner le moteur.

## 9. Note de processus — commit `e82427a` non amendé

Le hook de vérification de signature signale `e82427a` (committer `noreply@github.com`)
comme « Unverified ». **Décision ratifiée owner : ne pas amender.** Ce commit est le commit
de merge de la PR #80 **créé par GitHub lui-même** et déjà présent dans l'historique partagé
de `main` ; l'amender imposerait une réécriture d'historique mergé et un force-push —
interdits par la charte (§5). Faux positif documenté, aucune action.
