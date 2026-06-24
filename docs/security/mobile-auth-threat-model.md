# MobileAuth — Threat Model & Test Plan (GO-prep)

> Read-only analysis prepared 2026-06-23 for owner review **before** authorizing security tests.
> Source: `packages/backend/src/modules/mobile-auth/`. Every claim is file:line-cited.

## Role
Customer-facing mobile authentication for the Wesley Club loyalty app. Handles registration (email+password, issues loyalty card + welcome coupon), login, JWT access/refresh token issuance, refresh-token rotation, and self-service profile read/update/soft-delete (RGPD). Identity is CustomerEntity. Tokens carry audience 'mobile-app' to keep customer tokens separate from the employee auth module (modules/auth).

## Attack surface
- POST /mobile/auth/register — create customer, bcrypt-hash password, issue token pair (controller:29-35; @Throttle 3/h per IP at controller:31)
- POST /mobile/auth/login — verify email+password via bcrypt.compare, issue token pair (controller:37-43; @Throttle 5/min per IP at controller:39)
- POST /mobile/auth/refresh — verify refresh JWT and re-issue token pair (controller:45-50; NO @Throttle override, only the global ThrottlerGuard applies)
- POST /mobile/auth/logout — no-op returning {success:true}; pure client-side token discard, no server-side revocation (controller:52-57)
- GET /mobile/me — read own profile, guarded by MobileAuthGuard (controller:59-65; service:106-120)
- PATCH /mobile/me — update firstName/preferredStoreId on own record, guarded (controller:67-73; service:122-136)
- DELETE /mobile/me — soft-delete own account (sets deleted_at only; anonymisation gated off per M302), guarded (controller:75-85; service:138-145)

## Security invariants
| Invariant | Status | Evidence |
|---|---|---|
| Access/refresh tokens are HMAC-signed with a server-side secret (JWT_SECRET / JWT_REFRESH_SECRET); a client cannot mint a valid token | ✅ HOLDS | service:154-163 signs with jwt.sign using process.env.JWT_SECRET / JWT_REFRESH_SECRET (HS256 default). main.ts:134-155 fails boot if JWT_SECRET/JWT_REFRESH_SECRET are missing, equal to known dev defaults, or shorter than 32 chars. Guard verifies signature at guard:33. |
| Protected routes verify the JWT signature before trusting identity | ✅ HOLDS | MobileAuthGuard.canActivate calls jwt.verify(token, secret, {audience:'mobile-app'}) at guard:33 and only then sets req.customer={id:payload.sub} at guard:41. No code path sets req.customer without a verified token. |
| alg=none / unsigned tokens are rejected | ✅ HOLDS | guard:33 and service:91 use the default jwt.verify with a string secret. jsonwebtoken treats a string secret as HMAC and rejects alg:none unless algorithms:['none'] is explicitly allowed (it is not), so an alg=none token fails verification. |
| Audience isolation: an employee token cannot access mobile customer routes | ❓ UNCLEAR | guard:33-39 enforces audience:'mobile-app' AND re-checks payload.aud==='mobile-app'. This blocks employee tokens ONLY IF employee tokens use a different aud AND/OR a different signing secret. modules/auth uses the same JWT_SECRET (auth.module.ts:19, jwt.strategy.ts:12). Isolation therefore rests entirely on the employee token NOT carrying aud='mobile-app'. The employee token's aud was not confirmed in this read; if an employee JWT has no aud or a different aud, isolation holds. Needs confirmation of modules/auth token claims. |
| IDOR: a customer can only read/modify/delete their own record | ✅ HOLDS | getMe/updateMe/deleteMe (service:106-145) operate on customerId taken from req.customer.id (controller:64,71,84), which is the verified payload.sub. There is no caller-supplied id parameter, so a caller cannot target another customer's record. |
| Passwords are stored hashed (not plaintext/reversible) | ✅ HOLDS | service:48 bcrypt.hash(input.password, 10) before save; entity stores password_hash (customer.entity:46-47). Login uses bcrypt.compare (service:81). No plaintext password column exists. |
| Secrets/hashes are never returned in responses or logged | ✅ HOLDS | buildAuthResponse returns only {accessToken, refreshToken, customer:{id,email,firstName}} (service:165-173); getMe returns no passwordHash (service:111-119). No console/logger calls in the service. (Caveat: tokens themselves are returned by design.) |
| Refresh validates token signature AND that the subject still exists/active before re-issuing | ✅ HOLDS | service:88-104 jwt.verify(refreshToken, refreshSecret, {audience:'mobile-app'}) then findOne by payload.sub with deletedAt IsNull(); throws UnauthorizedException if customer missing. A deleted/soft-deleted customer cannot refresh. |
| Access tokens expire (short TTL) | ✅ HOLDS | ACCESS_TOKEN_TTL='15m' (service:15) passed as expiresIn (service:157); guard maps TokenExpiredError to 401 (guard:44-45). |
| Tokens can be revoked / invalidated server-side (e.g. on logout, password change, or compromise) | ❌ VIOLATED | logout is a no-op (controller:52-57). No jti/denylist/tokenVersion exists (grep for revoke/blacklist/jti/tokenVersion returned nothing in mobile-auth or the guard). A leaked access token is valid for its full 15m and a leaked refresh token for the full 30d (REFRESH_TOKEN_TTL, service:16) with no way to invalidate it. |


## Threats
| Threat | Severity | Current state | A test must prove |
|---|---|---|---|
| No server-side token revocation — leaked/stolen token remains valid | 🟠 high | logout is a no-op (controller:52-57); no denylist/jti/tokenVersion anywhere (grep empty). deleteMe sets deleted_at (service:138-145) which blocks future refresh (refresh filters deletedAt IsNull, service:96) but does NOT invalidate an already-issued 30d refresh token's signature, and an outstanding 15m access token still passes the guard until expiry because the guard never hits the DB (guard:41 trusts payload.sub with no existence/deleted check). | After logout or account soft-delete, a previously issued ACCESS token is rejected on /mobile/me (currently it would NOT be — this is the key gap a test must expose), and a previously issued refresh token cannot mint new tokens. |
| Refresh-endpoint brute force / credential stuffing of refresh tokens | 🟡 medium | POST /mobile/auth/refresh has NO per-route @Throttle (controller:45-50); only the global ThrottlerGuard tiers apply (app.module:87-91: long tier default 30000/h). register and login ARE tightly throttled (3/h, 5/min) but refresh is effectively wide open at 30k/h per IP. | refresh is rate-limited at a value appropriate for token verification (and ideally that signature failures are counted); a flood of invalid refresh tokens from one IP gets 429 before exhausting the global budget. |
| Guard trusts token sub without confirming the customer still exists / is not soft-deleted | 🟡 medium | MobileAuthGuard sets req.customer={id:payload.sub} purely from the verified JWT (guard:41) with no DB lookup. getMe/updateMe DO re-query with deletedAt IsNull (service:107-110,135) so they 401 a deleted user, but any future guarded route that trusts req.customer.id without re-querying would serve a soft-deleted/anonymised customer for up to 15m. | A soft-deleted customer's still-valid access token is rejected by guarded read/write routes (getMe currently returns 401 via its own query — assert that; assert the guard contract for any route that does not re-query). |
| Audience cross-use: employee token reaching mobile routes (or vice versa) because both share JWT_SECRET | 🟡 medium | Both employee and mobile sign with the same JWT_SECRET (jwt.strategy:12, auth.module:19, service:148). Mobile guard enforces aud='mobile-app' (guard:33-39). Cross-use is blocked only if employee tokens lack aud='mobile-app'. The employee token's claims were not confirmed in this read. | An employee-issued JWT (real claim set from modules/auth) is rejected by MobileAuthGuard, and a mobile JWT is rejected by the employee JwtAuthGuard — proving aud isolation actually holds across both issuers signed with the shared secret. |
| Token forgery via weak/absent secret (client mints its own token) | ⚪ low | Tokens are HS256-signed with JWT_SECRET; boot-time validation in main.ts:134-155 rejects missing secrets, known dev defaults, and secrets <32 chars. realtime.module.ts:14 has a 'dev-insecure-secret-change-me' fallback but that is a different module and is gated by the same env presence check at boot. | A token signed with a wrong/empty secret, or an alg=none token, is rejected by both MobileAuthGuard and refresh(); a forged token never yields req.customer. |
| User enumeration on register vs login | ⚪ low | register throws ConflictException 'Un compte existe déjà avec cet email' (service:44-46), revealing whether an email is registered. login returns a generic 'Identifiants invalides' for both unknown user and bad password (service:79,83) — good. Registration is throttled to 3/h (controller:31), limiting enumeration rate. | login returns an identical generic error and similar timing for unknown-email vs wrong-password; registration enumeration is rate-limited (3/h). |
| Password policy weakness | ⚪ low | Minimum 8 chars enforced twice (DTO MinLength(8) at dto:18 and service:37-39), max 128 (dto:19). No complexity/breached-password check. bcrypt cost factor 10 (service:48) — acceptable but modest. | Passwords <8 chars are rejected with 400 at the DTO layer before the service runs; >128 rejected; the stored value is a bcrypt hash, never the plaintext. |


## Testability
- **Cleanly mockable (tests never hit live API):** YES
- **How:** All collaborators are constructor-injected (service:20-25): @InjectRepository(CustomerEntity) customerRepo, LoyaltyCardService, CouponService. A unit test instantiates MobileAuthService with a mock Repository (jest.fn for findOne/create/save/update) and stubbed LoyaltyCardService/CouponService. bcrypt and jwt are real local libs (no network) so they can run for real or be mocked. JWT_SECRET/JWT_REFRESH_SECRET must be set as env in the test setup (the service reads process.env at call time, service:89,148-149 — so tests can set/override per case). The guard is independently testable by constructing a fake ExecutionContext with an authorization header. No live API client to inject.
- **Outbound live calls:**
  - No outbound HTTP/SDK calls in MobileAuthService
  - bcrypt.hash / bcrypt.compare (local CPU, service:48,81)
  - jwt.sign / jwt.verify (local, service:91,154,159; guard:33)
  - TypeORM customerRepo (findOne/create/save/update) against the DB
  - loyaltyCardService.createCard and couponService.issueWelcome (in-process Nest services, service:68-69)

## What tests must prove (plan)
1. register: a password <8 chars is rejected (400) and no customer is persisted (service:37-39, dto:18)
2. register: a duplicate active email throws ConflictException; a soft-deleted email (deletedAt set) does NOT block re-registration (service:41-46 filters deletedAt IsNull)
3. register: the persisted customer.passwordHash is a bcrypt hash, not the plaintext, and the response contains no passwordHash (service:48,165-173)
4. register: response includes accessToken+refreshToken that each verify against their respective secrets and carry aud='mobile-app' and sub=customer.id (service:154-163)
5. login: correct credentials return a token pair; wrong password and unknown email BOTH return identical generic 'Identifiants invalides' (service:78-84)
6. login: a customer with null passwordHash (e.g. legacy/social) is rejected, never auto-authenticated (service:78)
7. token: a token signed with a different secret, a tampered payload, or alg=none is rejected by MobileAuthGuard and by refresh() (guard:33; service:91)
8. guard: missing/malformed Authorization header yields 401 'Token requis' (guard:22-24); expired access token yields 401 'Token expiré' (guard:44-45)
9. guard: a verified token sets req.customer.id = payload.sub and nothing else (guard:41) — assert no other route can override identity
10. audience isolation: a real employee-issued JWT (from modules/auth) is rejected by MobileAuthGuard, and a mobile JWT is rejected by the employee guard (guard:33-39)
11. IDOR: getMe/updateMe/deleteMe operate only on req.customer.id; there is no caller-supplied id, so caller cannot reach another customer's record (service:106-145)
12. refresh: a valid refresh token for a soft-deleted customer is rejected (service:95-98 filters deletedAt IsNull)
13. revocation (currently failing — proves the gap): after deleteMe/logout, a previously issued ACCESS token is STILL accepted by the guard because the guard does not re-query the DB (guard:41) — assert the desired behavior (rejection) to document the open risk
14. brute force: login is throttled to 5/min and register to 3/h per IP (controller:31,39); refresh has NO per-route throttle and falls back to the global 30k/h tier (controller:45-50, app.module:87-91) — assert a stricter limit is required before GO
15. boot: app refuses to start when JWT_SECRET is missing, equals a known dev default, or is <32 chars (main.ts:134-155)

## GO readiness
**Recommendation:** CONDITIONAL GO for testing under GO. The core auth primitives are sound: passwords are bcrypt-hashed, tokens are HMAC-signed with a boot-validated >=32-char secret, alg=none is rejected, no secrets are logged or returned, there is no IDOR (identity comes only from the verified token sub), and login/register are rate-limited with generic error messages. It is safe to WRITE TESTS against this service read-only. However, do NOT treat it as production-hardened: two real gaps must be closed before relying on it in the field.

**Blockers before this code is production-safe:**
- No server-side token revocation: logout is a no-op and there is no jti/denylist/tokenVersion (controller:52-57; grep empty). A leaked access token is valid 15m and a leaked refresh token 30d with no kill switch. Soft-delete does not invalidate already-issued tokens. (HIGH)
- MobileAuthGuard trusts payload.sub without a DB existence/soft-delete check (guard:41); any guarded route that does not re-query (unlike getMe/updateMe) will serve a deleted/anonymised customer for up to 15m. (MEDIUM)
- POST /mobile/auth/refresh has no per-route @Throttle and falls back to the global 30k/h tier (controller:45-50, app.module:87-91), unlike the tightly throttled login/register. Add a strict throttle. (MEDIUM)
- Audience isolation across the shared JWT_SECRET is UNCONFIRMED: employee and mobile tokens are signed with the same secret, so isolation depends entirely on the employee token NOT carrying aud='mobile-app' — verify the employee token claim set in modules/auth before relying on it. (MEDIUM)

---
*Headline:* core primitives are sound (bcrypt, HMAC-signed tokens, alg=none rejected, no IDOR, short TTL, boot-time secret validation). The one **❌ VIOLATED** invariant is **no server-side token revocation** (logout is a no-op; no jti/denylist) — a leaked access token is valid for its full 15m and a refresh token for 30d, and soft-delete does not invalidate already-issued tokens. Audience isolation vs the employee auth module is **❓ UNCLEAR** (shared JWT_SECRET) and must be confirmed.
