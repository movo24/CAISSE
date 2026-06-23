# Stripe Billing & Subscriptions — Capture-Invariant Findings (GO-prep)

> Read-only analysis prepared 2026-06-23 for owner review **before** authorizing any code.
> Source: `packages/backend/src/modules/subscriptions/`. Every claim is file:line-cited.

## ⚠️ Headline — the capture invariant is VIOLATED in current code
The question "does anything mark paid/active without a confirmed capture?" — **yes, it does.** These are real defects, not just missing tests:
- **Stripe webhook grants a full paid plan without checking `payment_status === 'paid'`** (`stripe-billing.service.ts` handleCheckoutCompleted) — entitlement without captured payment.
- **`POST :storeId/change-plan` instantly grants Business/Enterprise with no payment** (`subscriptions.service.ts:182-193`) — free entitlement.
- **`change-plan`/`cancel`/`trial` lack `@Roles('admin')`** — any authenticated user (incl. cashier) can alter billing (privilege escalation).
- **Webhook trusts client-controlled `metadata.plan`** without reconciling the charged amount.
- **Idempotency is an in-memory `Set`** — non-durable, not multi-instance safe; events re-process after restart, and a failed handler is marked processed before it runs (so it never retries).

Mock-safety (the other half of the question) **is** satisfied: the Stripe client and repos are injected, so tests run with zero live-API risk.

**Implication for GO:** this is NOT "write tests for safe code." Several planned tests are written to **FAIL against current code** to document the violations. Fixing them changes live payment/entitlement behavior → owner-gated, design-first, not an autonomous test pass.

### Independent verification (main loop, 2026-06-23)
The three headline findings were re-confirmed by reading the source directly, not taken on the analysis agent's word:
- `subscriptions.service.ts changePlan`: sets `sub.status = 'active'` + `featuresEnabled`/`maxTerminals`/period with no payment gate. **Confirmed.**
- `roles.guard.ts`: `if (!requiredRoles) return true;` — **fail-open**; and `change-plan`/`cancel`/`trial` have `@UseGuards(...RolesGuard)` but no `@Roles('admin')` (while `checkout`/`portal` do). So any authenticated user passes. **Confirmed.**
- `stripe-billing.service.ts handleCheckoutCompleted`: sets `sub.status = 'active'` from `session.metadata`; no `session.payment_status === 'paid'` check anywhere in the handler. **Confirmed.**

---

## StripeBillingService

### Role
NestJS service that drives Stripe-hosted SaaS subscription billing for stores: creates Checkout Sessions for plan upgrades, creates Customer Portal sessions, and processes Stripe webhook events to transition the local SubscriptionEntity (trial/active/past_due/cancelled/suspended) and to mint plan entitlements (maxTerminals/maxProducts/maxEmployees/featuresEnabled) consumed by SubscriptionsService enforcement.

### Surface
- StripeBillingService.createCheckoutSession(storeId, plan, billingCycle, successUrl, cancelUrl) — stripe-billing.service.ts:33-101; exposed via POST /subscriptions/:storeId/checkout, subscriptions.controller.ts:116-146, guarded JwtAuthGuard+RolesGuard @Roles('admin')
- StripeBillingService.createPortalSession(storeId, returnUrl) — stripe-billing.service.ts:107-124; exposed via POST /subscriptions/:storeId/portal, controller:151-158, guarded JwtAuthGuard+RolesGuard @Roles('admin')
- StripeBillingService.handleWebhook(rawBody, signature) — stripe-billing.service.ts:130-199; exposed via POST /subscriptions/webhook, controller:164-183, @SkipTenantCheck() and NO auth guard (signature-trusted)
- Private webhook handlers: handleCheckoutCompleted:205-256, handleSubscriptionUpdated:258-284, handleSubscriptionDeleted:286-297, handlePaymentFailed:299-310

### Invariants
| Invariant | Status | Evidence |
|---|---|---|
| Webhook events are signature-verified before any state change | ✅ HOLDS | stripe-billing.service.ts:141-149 calls stripe.webhooks.constructEvent(rawBody, signature, webhookSecret) and throws BadRequestException on failure BEFORE the switch at :167; raw body is enabled in main.ts:236 (rawBody:true), and the controller passes req.rawBody (controller:172). Missing STRIPE_WEBHOOK_SECRET is hard-fail, not skip (:134-137). |
| A subscription is marked active/entitled only after a confirmed payment capture | ❌ VIOLATED | handleCheckoutCompleted (stripe-billing.service.ts:230-251) sets sub.status='active' and grants full plan entitlements solely on receipt of checkout.session.completed, reading only session.metadata (storeId/plan/billingCycle at :206-208). It NEVER checks session.payment_status === 'paid' or session.status === 'complete'. For mode:'subscription' Stripe can emit checkout.session.completed with payment_status 'unpaid'/'no_payment_required' (e.g. trials, async/delayed payment methods, SCA pending), so the store is entitled without a captured payment. |
| Payment-state writes are idempotent across retries and instances | ❌ VIOLATED | Dedup uses an in-process Set this.processedEvents (stripe-billing.service.ts:19, checked :155, added :160). It is lost on restart and not shared across replicas, so Stripe retries (or multi-instance delivery) re-run handlers. A persistent IdempotencyKeyEntity exists (database/entities/idempotency-key.entity.ts) but is NOT used here. eventCacheKey at :154 is computed and never used (dead code). |
| Outbound payment-mutating Stripe calls carry idempotency keys | ❌ VIOLATED | stripe.customers.create (:58-62) and stripe.checkout.sessions.create (:72-94) are called with no { idempotencyKey } request option. A retried createCheckout can create duplicate Stripe customers / sessions. |
| Webhook handler results are reported to Stripe so failures trigger retry, and dedup is not committed before success | ❌ VIOLATED | Event id is added to processedEvents at :160 BEFORE the handlers run (:167-198). If a handler throws, the controller returns 400 (controller:180-182) and Stripe retries, but the in-memory copy (same process) would now skip it as already-processed — a failed activation can be permanently dropped on the same instance. Dedup-before-work is incorrect ordering. |
| Webhook endpoint cannot be abused without a valid signature | ✅ HOLDS | No auth guard is intentional (controller:164-166) but constructEvent (:141) rejects any request lacking a valid Stripe signature, so unauthenticated callers cannot mutate state. Caveat: combined with the capture-invariant gap, the trust boundary is the signature alone — acceptable for Stripe but means metadata is fully attacker-uncontrolled only if the secret is secret. |
| Stripe client is configured-or-fail (no silent live calls in tests) | ❓ UNCLEAR | StripeModule useFactory returns null when STRIPE_SECRET_KEY unset (common/stripe/stripe.module.ts:8-13). assertStripeConfigured (:312-318) guards null. But the guard runs only at method entry; constructEvent and SDK calls assume a real client otherwise. In tests the injected 'STRIPE' token must be a mock or the service no-ops via the null guard — depends on test wiring. |


### Threats
| Threat | Severity | Current state | A test must prove |
|---|---|---|---|
| Entitlement without captured payment: a checkout.session.completed with payment_status != 'paid' grants a full paid plan | 🔴 critical | handleCheckoutCompleted activates and grants entitlements without inspecting payment_status/status — stripe-billing.service.ts:230-251 | Given a checkout.session.completed event whose object.payment_status is 'unpaid' (or 'no_payment_required'), the subscription is NOT set to 'active' and entitlements are NOT granted; only payment_status 'paid' yields active. |
| Duplicate/replayed webhook re-processing after restart or on a second instance corrupts billing state | 🟠 high | In-memory Set dedup, non-durable, non-shared; persistent IdempotencyKeyEntity unused — stripe-billing.service.ts:19,155,160 | Processing the same event.id twice across a simulated restart (fresh service instance) is a no-op the second time AND is backed by a durable store; assert handler side-effects (subRepo.save) run exactly once. |
| Failed handler is permanently skipped because the event was marked processed before it ran | 🟠 high | processedEvents.add happens at :160 before the switch at :167; a throw returns 400 but same-process retry is suppressed | If a handler throws, the event is NOT recorded as processed (so a Stripe retry re-executes it) and the controller returns a non-2xx so Stripe retries. |
| Duplicate Stripe customers/sessions from retried createCheckout (no idempotency key) | 🟡 medium | customers.create:58 and checkout.sessions.create:72 lack idempotencyKey | Two identical createCheckoutSession calls (same storeId/plan) reuse one Stripe customer and pass a stable idempotencyKey to the SDK; assert the mock received the option. |
| Stale stripeCustomerId persistence: when no local sub row exists, the created Stripe customer id is discarded | 🟡 medium | createCheckoutSession only saves customerId if sub exists (:66-69); if sub is null the new customer id is never persisted, orphaning the customer and forcing re-creation | createCheckoutSession when no SubscriptionEntity exists either creates the row with stripeCustomerId or fails cleanly — it must not silently create an unlinked Stripe customer. |
| handleCheckoutCompleted silently no-ops when local sub row is missing, so a paid customer gets no entitlement | 🟡 medium | returns early if subRepo.findOne is null — stripe-billing.service.ts:215-219 (logs warn only) | A paid checkout for a store with no pre-existing subscription row results in an active subscription (created) rather than a silently dropped payment. |
| Webhook never confirms subscription/payment via Stripe API (trusts client-side metadata only) | 🟡 medium | All state derived from event payload + metadata; no stripe.subscriptions.retrieve / invoice cross-check — stripe-billing.service.ts:205-310 | Decide and assert the trust model: if metadata-only is accepted, a test must prove signature is the sole gate and payment_status is still enforced (see critical threat). |


### Testability
- **Cleanly mockable (tests never hit live API):** YES
- **How:** The Stripe client is constructor-injected via @Inject('STRIPE') (stripe-billing.service.ts:22), provided by a Global StripeModule useFactory (common/stripe/stripe.module.ts:4-16). It is NOT newed-up inline in this service, so a test provides a fake 'STRIPE' token (jest mock with customers.create, checkout.sessions.create, billingPortal.sessions.create, webhooks.constructEvent) and never touches the live API. The repositories (SubscriptionEntity, StoreEntity) are also injected via @InjectRepository and mockable. Caveat: webhooks.constructEvent does real HMAC verification, so signature-verification tests must either stub constructEvent to return a crafted Stripe.Event or compute a valid test signature with a known test secret; STRIPE_WEBHOOK_SECRET is read from process.env (:133) and must be set in the test env.
- **Outbound live calls:**
  - stripe.customers.create(...) — createCheckoutSession:58-62, creates a Stripe Customer
  - stripe.checkout.sessions.create(...) — createCheckoutSession:72-94, creates a hosted Checkout Session (mode:subscription, inline price_data)
  - stripe.billingPortal.sessions.create(...) — createPortalSession:118-121, creates a Customer Portal session
  - stripe.webhooks.constructEvent(rawBody, signature, secret) — handleWebhook:141-145, signature-verifies and parses the event (local crypto, no network, but on the Stripe SDK)

### Test plan
1. Assert handleWebhook throws/returns 400 and performs NO subRepo.save when the signature is invalid (constructEvent throws).
2. Assert handleWebhook throws when STRIPE_WEBHOOK_SECRET is unset (no fallback to processing) — stripe-billing.service.ts:134-137.
3. Assert a checkout.session.completed with payment_status !== 'paid' does NOT set status='active' (this test FAILS today, proving the capture-invariant gap).
4. Assert a checkout.session.completed with payment_status === 'paid' sets status='active' and grants exactly the PLAN_CATALOG entitlements for the plan/billingCycle in metadata.
5. Assert the same event.id processed twice results in exactly one subRepo.save, AND survives a new service instance (durable idempotency) — FAILS today (in-memory Set).
6. Assert that if a webhook handler throws, the event is NOT marked processed and the controller returns non-2xx (so Stripe retries) — FAILS today (add-before-run at :160).
7. Assert createCheckoutSession passes a stable idempotencyKey to stripe.customers.create and stripe.checkout.sessions.create — FAILS today.
8. Assert createCheckoutSession reuses an existing sub.stripeCustomerId and does not call customers.create when one is present (:55-70).
9. Assert createCheckoutSession persists the new stripeCustomerId even when handling stores without a sub row (or fails cleanly) — currently discarded at :66-69.
10. Assert createCheckoutSession rejects free/0-price plans (BadRequest at :50) and unknown plans (:43).
11. Assert handleCheckoutCompleted with a paid event but missing local sub row creates entitlement rather than silently returning (:215-219).
12. Assert createPortalSession throws BadRequest when no stripeCustomerId (:114-116) and otherwise calls billingPortal.sessions.create with the stored customer id.
13. Assert handleSubscriptionUpdated maps Stripe statuses active/past_due/canceled to local active/past_due/cancelled and writes period dates (:258-284).
14. Assert handlePaymentFailed sets status='past_due' for the matched stripeCustomerId (:299-310).
15. Negative: assert no test in the suite issues a live Stripe network call (the injected client is a mock; fail the suite if real Stripe key is detected).

### GO readiness
**Recommendation:** GO for writing tests under a mocked Stripe client — the service is read-only-analyzable and the client/repos are cleanly injected, so tests can be authored with zero risk of hitting the live API. Do NOT treat the billing logic as production-safe: the capture invariant is VIOLATED (activation without verifying payment_status) and idempotency is non-durable. Author the test plan as written, expecting several assertions to FAIL against current code — those failures are the documented defects for the owner to authorize fixes before any real-money GO. Hard precondition for any test run: set STRIPE_SECRET_KEY to a dummy/test value and STRIPE_WEBHOOK_SECRET to a test value, and inject a mock 'STRIPE' provider so nothing reaches Stripe.

**Blockers before this code is production-safe:**
- CAPTURE INVARIANT: handleCheckoutCompleted grants 'active' + entitlements without checking session.payment_status==='paid' (stripe-billing.service.ts:230-251) — must be fixed before processing live payments.
- IDEMPOTENCY: in-memory Set dedup (:19,155,160) is non-durable and not multi-instance safe; persistent IdempotencyKeyEntity exists but unused — duplicate/replayed events can corrupt billing state.
- RETRY CORRECTNESS: event marked processed before handler runs (:160 vs :167) — failed activations can be permanently dropped; reorder to mark-after-success.
- MISSING SDK IDEMPOTENCY KEYS on customers.create (:58) and checkout.sessions.create (:72) — duplicate customers/sessions on retry.
- TEST ENV: STRIPE_WEBHOOK_SECRET must be present or handleWebhook hard-fails (:133-137); confirm test harness sets it and injects a mock Stripe client to avoid live calls.

---

## SubscriptionsService

### Role
NestJS service that drives Stripe-hosted SaaS subscription billing for stores: creates Checkout Sessions for plan upgrades, creates Customer Portal sessions, and processes Stripe webhook events to transition the local SubscriptionEntity (trial/active/past_due/cancelled/suspended) and to mint plan entitlements (maxTerminals/maxProducts/maxEmployees/featuresEnabled) consumed by SubscriptionsService enforcement.

### Surface
- StripeBillingService.createCheckoutSession(storeId, plan, billingCycle, successUrl, cancelUrl) — stripe-billing.service.ts:33-101; exposed via POST /subscriptions/:storeId/checkout, subscriptions.controller.ts:116-146, guarded JwtAuthGuard+RolesGuard @Roles('admin')
- StripeBillingService.createPortalSession(storeId, returnUrl) — stripe-billing.service.ts:107-124; exposed via POST /subscriptions/:storeId/portal, controller:151-158, guarded JwtAuthGuard+RolesGuard @Roles('admin')
- StripeBillingService.handleWebhook(rawBody, signature) — stripe-billing.service.ts:130-199; exposed via POST /subscriptions/webhook, controller:164-183, @SkipTenantCheck() and NO auth guard (signature-trusted)
- Private webhook handlers: handleCheckoutCompleted:205-256, handleSubscriptionUpdated:258-284, handleSubscriptionDeleted:286-297, handlePaymentFailed:299-310

### Invariants
| Invariant | Status | Evidence |
|---|---|---|
| Webhook events are signature-verified before any state change | ✅ HOLDS | stripe-billing.service.ts:141-149 calls stripe.webhooks.constructEvent(rawBody, signature, webhookSecret) and throws BadRequestException on failure BEFORE the switch at :167; raw body is enabled in main.ts:236 (rawBody:true), and the controller passes req.rawBody (controller:172). Missing STRIPE_WEBHOOK_SECRET is hard-fail, not skip (:134-137). |
| A subscription is marked active/entitled only after a confirmed payment capture | ❌ VIOLATED | handleCheckoutCompleted (stripe-billing.service.ts:230-251) sets sub.status='active' and grants full plan entitlements solely on receipt of checkout.session.completed, reading only session.metadata (storeId/plan/billingCycle at :206-208). It NEVER checks session.payment_status === 'paid' or session.status === 'complete'. For mode:'subscription' Stripe can emit checkout.session.completed with payment_status 'unpaid'/'no_payment_required' (e.g. trials, async/delayed payment methods, SCA pending), so the store is entitled without a captured payment. |
| Payment-state writes are idempotent across retries and instances | ❌ VIOLATED | Dedup uses an in-process Set this.processedEvents (stripe-billing.service.ts:19, checked :155, added :160). It is lost on restart and not shared across replicas, so Stripe retries (or multi-instance delivery) re-run handlers. A persistent IdempotencyKeyEntity exists (database/entities/idempotency-key.entity.ts) but is NOT used here. eventCacheKey at :154 is computed and never used (dead code). |
| Outbound payment-mutating Stripe calls carry idempotency keys | ❌ VIOLATED | stripe.customers.create (:58-62) and stripe.checkout.sessions.create (:72-94) are called with no { idempotencyKey } request option. A retried createCheckout can create duplicate Stripe customers / sessions. |
| Webhook handler results are reported to Stripe so failures trigger retry, and dedup is not committed before success | ❌ VIOLATED | Event id is added to processedEvents at :160 BEFORE the handlers run (:167-198). If a handler throws, the controller returns 400 (controller:180-182) and Stripe retries, but the in-memory copy (same process) would now skip it as already-processed — a failed activation can be permanently dropped on the same instance. Dedup-before-work is incorrect ordering. |
| Webhook endpoint cannot be abused without a valid signature | ✅ HOLDS | No auth guard is intentional (controller:164-166) but constructEvent (:141) rejects any request lacking a valid Stripe signature, so unauthenticated callers cannot mutate state. Caveat: combined with the capture-invariant gap, the trust boundary is the signature alone — acceptable for Stripe but means metadata is fully attacker-uncontrolled only if the secret is secret. |
| Stripe client is configured-or-fail (no silent live calls in tests) | ❓ UNCLEAR | StripeModule useFactory returns null when STRIPE_SECRET_KEY unset (common/stripe/stripe.module.ts:8-13). assertStripeConfigured (:312-318) guards null. But the guard runs only at method entry; constructEvent and SDK calls assume a real client otherwise. In tests the injected 'STRIPE' token must be a mock or the service no-ops via the null guard — depends on test wiring. |


### Threats
| Threat | Severity | Current state | A test must prove |
|---|---|---|---|
| Entitlement without captured payment: a checkout.session.completed with payment_status != 'paid' grants a full paid plan | 🔴 critical | handleCheckoutCompleted activates and grants entitlements without inspecting payment_status/status — stripe-billing.service.ts:230-251 | Given a checkout.session.completed event whose object.payment_status is 'unpaid' (or 'no_payment_required'), the subscription is NOT set to 'active' and entitlements are NOT granted; only payment_status 'paid' yields active. |
| Duplicate/replayed webhook re-processing after restart or on a second instance corrupts billing state | 🟠 high | In-memory Set dedup, non-durable, non-shared; persistent IdempotencyKeyEntity unused — stripe-billing.service.ts:19,155,160 | Processing the same event.id twice across a simulated restart (fresh service instance) is a no-op the second time AND is backed by a durable store; assert handler side-effects (subRepo.save) run exactly once. |
| Failed handler is permanently skipped because the event was marked processed before it ran | 🟠 high | processedEvents.add happens at :160 before the switch at :167; a throw returns 400 but same-process retry is suppressed | If a handler throws, the event is NOT recorded as processed (so a Stripe retry re-executes it) and the controller returns a non-2xx so Stripe retries. |
| Duplicate Stripe customers/sessions from retried createCheckout (no idempotency key) | 🟡 medium | customers.create:58 and checkout.sessions.create:72 lack idempotencyKey | Two identical createCheckoutSession calls (same storeId/plan) reuse one Stripe customer and pass a stable idempotencyKey to the SDK; assert the mock received the option. |
| Stale stripeCustomerId persistence: when no local sub row exists, the created Stripe customer id is discarded | 🟡 medium | createCheckoutSession only saves customerId if sub exists (:66-69); if sub is null the new customer id is never persisted, orphaning the customer and forcing re-creation | createCheckoutSession when no SubscriptionEntity exists either creates the row with stripeCustomerId or fails cleanly — it must not silently create an unlinked Stripe customer. |
| handleCheckoutCompleted silently no-ops when local sub row is missing, so a paid customer gets no entitlement | 🟡 medium | returns early if subRepo.findOne is null — stripe-billing.service.ts:215-219 (logs warn only) | A paid checkout for a store with no pre-existing subscription row results in an active subscription (created) rather than a silently dropped payment. |
| Webhook never confirms subscription/payment via Stripe API (trusts client-side metadata only) | 🟡 medium | All state derived from event payload + metadata; no stripe.subscriptions.retrieve / invoice cross-check — stripe-billing.service.ts:205-310 | Decide and assert the trust model: if metadata-only is accepted, a test must prove signature is the sole gate and payment_status is still enforced (see critical threat). |


### Test plan
1. Assert handleWebhook throws/returns 400 and performs NO subRepo.save when the signature is invalid (constructEvent throws).
2. Assert handleWebhook throws when STRIPE_WEBHOOK_SECRET is unset (no fallback to processing) — stripe-billing.service.ts:134-137.
3. Assert a checkout.session.completed with payment_status !== 'paid' does NOT set status='active' (this test FAILS today, proving the capture-invariant gap).
4. Assert a checkout.session.completed with payment_status === 'paid' sets status='active' and grants exactly the PLAN_CATALOG entitlements for the plan/billingCycle in metadata.
5. Assert the same event.id processed twice results in exactly one subRepo.save, AND survives a new service instance (durable idempotency) — FAILS today (in-memory Set).
6. Assert that if a webhook handler throws, the event is NOT marked processed and the controller returns non-2xx (so Stripe retries) — FAILS today (add-before-run at :160).
7. Assert createCheckoutSession passes a stable idempotencyKey to stripe.customers.create and stripe.checkout.sessions.create — FAILS today.
8. Assert createCheckoutSession reuses an existing sub.stripeCustomerId and does not call customers.create when one is present (:55-70).
9. Assert createCheckoutSession persists the new stripeCustomerId even when handling stores without a sub row (or fails cleanly) — currently discarded at :66-69.
10. Assert createCheckoutSession rejects free/0-price plans (BadRequest at :50) and unknown plans (:43).
11. Assert handleCheckoutCompleted with a paid event but missing local sub row creates entitlement rather than silently returning (:215-219).
12. Assert createPortalSession throws BadRequest when no stripeCustomerId (:114-116) and otherwise calls billingPortal.sessions.create with the stored customer id.
13. Assert handleSubscriptionUpdated maps Stripe statuses active/past_due/canceled to local active/past_due/cancelled and writes period dates (:258-284).
14. Assert handlePaymentFailed sets status='past_due' for the matched stripeCustomerId (:299-310).
15. Negative: assert no test in the suite issues a live Stripe network call (the injected client is a mock; fail the suite if real Stripe key is detected).

### GO readiness
**Recommendation:** GO for writing tests under a mocked Stripe client — the service is read-only-analyzable and the client/repos are cleanly injected, so tests can be authored with zero risk of hitting the live API. Do NOT treat the billing logic as production-safe: the capture invariant is VIOLATED (activation without verifying payment_status) and idempotency is non-durable. Author the test plan as written, expecting several assertions to FAIL against current code — those failures are the documented defects for the owner to authorize fixes before any real-money GO. Hard precondition for any test run: set STRIPE_SECRET_KEY to a dummy/test value and STRIPE_WEBHOOK_SECRET to a test value, and inject a mock 'STRIPE' provider so nothing reaches Stripe.

**Blockers before this code is production-safe:**
- CAPTURE INVARIANT: handleCheckoutCompleted grants 'active' + entitlements without checking session.payment_status==='paid' (stripe-billing.service.ts:230-251) — must be fixed before processing live payments.
- IDEMPOTENCY: in-memory Set dedup (:19,155,160) is non-durable and not multi-instance safe; persistent IdempotencyKeyEntity exists but unused — duplicate/replayed events can corrupt billing state.
- RETRY CORRECTNESS: event marked processed before handler runs (:160 vs :167) — failed activations can be permanently dropped; reorder to mark-after-success.
- MISSING SDK IDEMPOTENCY KEYS on customers.create (:58) and checkout.sessions.create (:72) — duplicate customers/sessions on retry.
- TEST ENV: STRIPE_WEBHOOK_SECRET must be present or handleWebhook hard-fails (:133-137); confirm test harness sets it and injects a mock Stripe client to avoid live calls.
