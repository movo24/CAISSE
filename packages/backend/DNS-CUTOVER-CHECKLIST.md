# DNS Cutover Checklist — `api.addxintelligence.com` → Railway

> ⚠️ **DO NOT EXECUTE** until 24h stabilization on the native URL has elapsed
> AND user gives explicit "go DNS" command.

## Pre-flight (verify all green)

- [ ] `/api/health` on `caisse-backend-production.up.railway.app` returned 200 continuously for 24h
- [ ] No FAILED/CRASHED deployments in the last 24h
- [ ] Memory usage < 200 MB (check Railway dashboard `Metrics`)
- [ ] No 5xx errors in Deploy Logs (filter "ERROR" tab)
- [ ] UptimeRobot showing 100% over the last 24h
- [ ] Wesley Club E2E (register → login → /me → /loyalty-card) still green
- [ ] POS critical endpoints (`/api/auth/login/pin`, `/api/products`, `/api/sales`) reachable

## Cutover sequence

### Step 1 — Cloudflare DNS update

The current `api.addxintelligence.com` CNAME points to the OLD Railway domain `bgzfcn8a.up.railway.app` (which returns 404 — service deleted).

1. Log into Cloudflare → zone `addxintelligence.com`
2. DNS → Records → find `api` (CNAME)
3. Update target:
   - **From:** `bgzfcn8a.up.railway.app`
   - **To:** `caisse-backend-production.up.railway.app`
4. Proxy status: **DNS only** (gray cloud) initially — Railway already provides HTTPS via its edge. If you want Cloudflare in front, keep proxy ON, but verify Railway accepts traffic with Cloudflare's headers.
5. TTL: keep current (5 min recommended for fast rollback)
6. Save

### Step 2 — Add custom domain in Railway

```graphql
mutation {
  customDomainCreate(input: {
    serviceId: "a7b2748a-6000-4a32-802b-0e9319287f43"
    environmentId: "7ade5bb3-4e17-4460-a6c0-f50995bded67"
    domain: "api.addxintelligence.com"
    targetPort: 8080
  }) { id domain }
}
```

Or via dashboard: caisse-backend service → Settings → Networking → Custom Domain → add `api.addxintelligence.com` → port 8080.

Railway will:
- Verify DNS CNAME points to a Railway domain
- Issue Let's Encrypt certificate (~1-3 minutes)

### Step 3 — Wait DNS propagation

```bash
# Loop until DNS resolves to Railway's IP
until dig +short api.addxintelligence.com | grep -q caisse-backend; do
  echo "$(date +%H:%M:%S) waiting..."
  sleep 30
done
```

### Step 4 — Verify cutover

```bash
# Should be 200 from the new backend
curl -i https://api.addxintelligence.com/api/health

# Verify it's served by the new Railway service (not the old 404)
# Look for: server: railway-edge AND status 200 + valid JSON
```

### Step 5 — Frontend smoke

- POS desktop: open https://pos.addxintelligence.com → cashier login → ticket creation
- Backoffice: https://app.addxintelligence.com → admin login → check products page
- Mobile: https://m.addxintelligence.com → connect with existing customer
- Customer app (TestFlight): scan QR card

### Step 6 — Inform users

- Wesley shop managers may notice POS reconnect (JWT was rotated)
- Wesley Club mobile users will need to re-login
- Plan a 30-min window with reduced traffic if possible

## Rollback procedure

If anything is broken after cutover:

1. Cloudflare → DNS → revert CNAME `api` to `bgzfcn8a.up.railway.app`
   - But this is a dead service (404) — there's no working "old" backend
   - Effectively the rollback is "go back to fully broken state"

The safer fallback: leave the cutover in place and fix forward. The old backend is gone.

## Post-cutover

- [ ] Update Cloudflare proxy ON if desired (cache, rate limit, WAF)
- [ ] Set up Sentry error tracking (still missing)
- [ ] Set up Redis (rate-limit multi-instance safety)
- [ ] Schedule next iteration: Risk Radar V1 → Wesley Phase 3 → Sprint IA V1
