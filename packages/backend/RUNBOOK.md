# CAISSE Backend — Operations Runbook

## Production deployment (current)

| Item | Value |
|---|---|
| Platform | Railway |
| Workspace | `vibrant-freedom` |
| Project ID | `2f5e0afc-d6ed-4360-9837-0356e9be0989` |
| Service ID | `a7b2748a-6000-4a32-802b-0e9319287f43` |
| Service name | `caisse-backend` |
| Environment | `production` (id `7ade5bb3-4e17-4460-a6c0-f50995bded67`) |
| Native URL | `https://caisse-backend-production.up.railway.app` |
| Custom domain | _(pending DNS cutover — `api.addxintelligence.com`)_ |
| Source | GitHub `movo24/CAISSE` branch `main` |
| Build | Dockerfile in `packages/backend/Dockerfile` |
| Root directory | `packages/backend` |
| Health path | `/api/health` (returns 503 on DB down) |
| Database | Neon, project `ep-square-violet-agqygacb-pooler`, db `caisse_pos` |
| Listen port (in container) | 8080 (Railway-injected `PORT`) — domain `targetPort` MUST match |

## Quick commands

```bash
# Health check
curl https://caisse-backend-production.up.railway.app/api/health

# Get latest deployment status
TOKEN=<RAILWAY_API_TOKEN>
curl -sS -X POST https://backboard.railway.app/graphql/v2 \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"{ deployments(first:1, input:{projectId:\"<PROJECT>\", serviceId:\"<SERVICE>\", environmentId:\"<ENV>\"}) { edges { node { id status meta } } } }"}'

# Force redeploy of latest main commit
SHA=$(git rev-parse main)
curl -sS -X POST https://backboard.railway.app/graphql/v2 \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"query\":\"mutation { serviceInstanceDeployV2(serviceId: \\\"$SERVICE\\\", environmentId: \\\"$ENV\\\", commitSha: \\\"$SHA\\\") }\"}"
```

## Deploys NOT auto-triggered by git push

Because Railway's GitHub App on the workspace cannot register a webhook
on `movo24/CAISSE` (cross-account permission limitation), **every commit
to main requires a manual deploy trigger** via the Railway API or
dashboard. The `serviceInstanceDeployV2` mutation accepts a `commitSha`
to deploy a specific commit.

To enable auto-deploy long term, transfer the repo into the
`y5ctnxgdc9-hue` GitHub account (or move the Railway workspace to a
project tied to `movo24` directly).

## Required env vars (must NEVER be committed)

| Var | Purpose | Source / format |
|---|---|---|
| `NODE_ENV` | `production` | static |
| `DATABASE_URL` | Neon connection | `postgresql://neondb_owner:***@ep-square-violet-agqygacb-pooler.c-2.eu-central-1.aws.neon.tech/caisse_pos?sslmode=require` |
| `JWT_SECRET` | access-token HMAC | 64-char hex (`openssl rand -hex 32`) |
| `JWT_REFRESH_SECRET` | refresh-token HMAC | 64-char hex, ≠ JWT_SECRET |
| `CORS_ORIGIN` | allowed frontend origins | comma-separated list |
| `LOG_LEVEL` | `info` (default) | `error\|warn\|info\|debug\|verbose` |

## Recommended (currently NOT set — V2 hardening)

| Var | Effect when unset | Action |
|---|---|---|
| `SENTRY_DSN` | error tracking disabled | Create Sentry project, add DSN |
| `REDIS_URL` | rate-limit & token revocation in-memory only (NOT multi-instance safe) | Add Redis service on Railway (or Upstash free tier) |
| `ALERT_WEBHOOK_URL` | Slack/Discord alerts disabled | Add Slack incoming webhook |

## Common operations

### Healthcheck failure → diagnose

1. `curl <url>/api/health` — does it return 503 (DB down) or timeout (pod down)?
2. Check Railway dashboard → Deploy Logs for boot errors
3. Common causes:
   - Missing required env var (DATABASE_URL / JWT_*) → app refuses to start
   - DB unreachable → 503 on /health, Railway restart loops
   - `domain.targetPort` ≠ app listen port → 502 from edge
   - TypeORM schema mismatch → boot crash with `DataTypeNotSupportedError`

### Domain returns 502 with `x-railway-fallback: true`

Container is unhealthy or not responding. Check:
- Container is "Active" in Railway dashboard?
- `domain.targetPort` matches what the app actually listens on (visible in `Deploy Logs` as `CAISSE API running on http://0.0.0.0:<PORT>`)
- Update via:

```graphql
mutation {
  serviceDomainUpdate(input: {
    serviceDomainId: "<DOMAIN_ID>"
    serviceId: "<SERVICE_ID>"
    environmentId: "<ENV_ID>"
    domain: "caisse-backend-production.up.railway.app"
    targetPort: 8080
  })
}
```

### Migrations

- Migrations run automatically at boot when `NODE_ENV=production` (`migrationsRun: isProd` in `app.module.ts`).
- Already-applied migrations are detected via the `migrations` table and skipped.
- New migration:
  ```bash
  cd packages/backend
  npm run migration:generate -- src/database/migrations/<NAME>
  ```
- **NEVER** run `db push --accept-data-loss` or set `TYPEORM_SYNCHRONIZE=true` in production. The app will refuse to boot if `NODE_ENV=production` and `TYPEORM_SYNCHRONIZE=true`.

### JWT secret rotation

⚠️ **Rotating `JWT_SECRET` invalidates ALL active sessions** (POS desktop + Wesley Club mobile).

Steps:
1. Generate new secret: `openssl rand -hex 32`
2. `variableUpsert` to set `JWT_SECRET` (and ideally `JWT_REFRESH_SECRET`)
3. Redeploy
4. All clients will receive 401 on next request → forced reconnect

### Backup / disaster recovery

- Neon offers point-in-time recovery (PITR) on paid tiers — verify the project has it enabled.
- Schema is in TypeORM migrations under `packages/backend/src/database/migrations/`.
- A full DB dump can be taken via `pg_dump` against the Neon URL.

## Smoke test checklist

```bash
URL=https://caisse-backend-production.up.railway.app

# Critical
curl -sS -o /dev/null -w "%{http_code}\n" $URL/api/health                                  # 200
curl -sS -o /dev/null -w "%{http_code}\n" $URL/api/products                                # 401 (auth required)
curl -sS -o /dev/null -w "%{http_code}\n" -X POST $URL/api/auth/login/pin                  # 400 (validation)
curl -sS -o /dev/null -w "%{http_code}\n" -X POST $URL/api/mobile/auth/login \
  -H "Content-Type: application/json" -d '{}'                                              # 400

# Wesley Club E2E
RAND="smoke-$(date +%s)@test.example"
curl -sS -X POST $URL/api/mobile/auth/register \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$RAND\",\"password\":\"smoketest1234\",\"firstName\":\"Smoke\"}"        # 201 + JWT
curl -sS -X POST $URL/api/mobile/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$RAND\",\"password\":\"smoketest1234\"}"                                # 200 + JWT
```

## Known gotchas

- Empty `@Body()` was not validated until DTO classes were added — historical bug fixed in commit `0eef6ca`.
- `jsonwebtoken` throws when `aud` is set both in payload AND `audience` option — historical bug fixed in commit `43ddd71`.
- `customer.store_id` column is `character varying` in prod (not `uuid`) — entity must use `type: 'varchar'`.

### Docker-compose path: backup / restore / hardened deploy (P285)

- `./docker/backup.sh` — compressed `pg_dump` of the `caisse-postgres` container into `docker/backups/`
  (gitignored ; integrity-checked ; retention 14). `list` / `restore <file>` subcommands (restore asks confirmation).
- `./docker/deploy.sh` — now gated: preflight → typed confirmation (`deploy`) → pre-deploy backup →
  build/up → real healthcheck wait (120 s max, no blind sleep) → in-container smoke tests (health 200,
  auth-guard 401) → status. Failure paths print the exact rollback commands. `YES=1` (CI) / `SKIP_BACKUP=1` overrides.
