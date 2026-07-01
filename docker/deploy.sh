#!/bin/bash
# ── deploy.sh — Deploy CAISSE to production (docker-compose path) ─────────────
# Usage: ./docker/deploy.sh            (interactive, with confirmation)
#        SKIP_BACKUP=1 ./docker/deploy.sh   (skip the pre-deploy DB backup)
#        YES=1 ./docker/deploy.sh          (non-interactive, CI use only)
#
# Hardened P285 (bloc A5): preflight gate → confirmation → pre-deploy backup →
# build → up → REAL healthcheck wait (no blind sleep) → smoke tests → status.
# Rollback hint printed on failure. This script only ever runs when a human
# executes it on the target host — nothing here auto-fires.
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

cd "$(dirname "$0")/.."   # repo root
COMPOSE_FILE="docker/docker-compose.prod.yml"
ENV_FILE="docker/.env.production"
COMPOSE="docker compose -f ${COMPOSE_FILE} --env-file ${ENV_FILE}"

echo "═══════════════════════════════════════════════════════════════"
echo "  CAISSE — Production Deployment"
echo "  Domain: addxintelligence.com"
echo "═══════════════════════════════════════════════════════════════"

# 0. Env file exists
if [ ! -f "$ENV_FILE" ]; then
    echo "ERROR: ${ENV_FILE} not found!"
    echo "Copy docker/.env.production.example to docker/.env.production and fill it."
    exit 1
fi

# 1. Preflight gate (structural checks — env completeness, gate flags OFF)
if [ -x scripts/preflight.sh ]; then
    echo "→ Preflight..."
    if ! scripts/preflight.sh; then
        echo "ERROR: preflight FAILED — fix the issues above before deploying."
        exit 1
    fi
else
    echo "WARN: scripts/preflight.sh missing or not executable — skipping preflight."
fi

# 2. Human confirmation (production guard)
if [ "${YES:-0}" != "1" ]; then
    printf "Deploy to PRODUCTION now? Type 'deploy' to confirm: "
    read -r answer
    [ "$answer" = "deploy" ] || { echo "Aborted."; exit 1; }
fi

# 3. Pre-deploy DB backup (skippable; harmless if postgres container not running yet)
if [ "${SKIP_BACKUP:-0}" != "1" ]; then
    if docker ps --format '{{.Names}}' | grep -q '^caisse-postgres$'; then
        echo "→ Pre-deploy backup..."
        ./docker/backup.sh || { echo "ERROR: backup failed — aborting deploy (use SKIP_BACKUP=1 to override)."; exit 1; }
    else
        echo "→ No running caisse-postgres container — skipping pre-deploy backup."
    fi
fi

# 4. Build & start
echo "→ Building all services..."
${COMPOSE} build

echo "→ Starting services..."
${COMPOSE} up -d

# 5. Wait for the backend healthcheck for real (max 120 s) — no blind sleep
echo "→ Waiting for backend /api/health..."
deadline=$((SECONDS + 120))
until docker inspect --format '{{.State.Health.Status}}' caisse-backend 2>/dev/null | grep -q healthy; do
    if [ $SECONDS -ge $deadline ]; then
        echo "ERROR: backend not healthy after 120 s."
        echo "  Logs:      ${COMPOSE} logs backend --tail 100"
        echo "  Rollback:  ${COMPOSE} down   (previous images remain; restore DB via docker/backup.sh list/restore)"
        exit 1
    fi
    sleep 3
done
echo "  backend healthy."

# 6. Smoke tests (read-only). Backend port is NOT exposed to the host (nginx
#    only), so we probe from INSIDE the backend container with its own wget.
echo "→ Smoke tests..."
smoke() { # path expected_code label
    code=$(docker exec caisse-backend sh -c \
        "wget -q -O /dev/null -T 10 --server-response 'http://localhost:3001$1' 2>&1 | awk '/^  HTTP\\//{print \$2}' | tail -1" \
        || echo "000")
    if [ "$code" = "$2" ]; then echo "  PASS  $3 ($code)"; else echo "  FAIL  $3 (got ${code:-000}, want $2)"; return 1; fi
}
smoke_fail=0
smoke "/api/health" 200 "health"            || smoke_fail=1
smoke "/api/products" 401 "auth guard"      || smoke_fail=1
if [ "$smoke_fail" = "1" ]; then
    echo "ERROR: smoke tests failed — inspect before routing traffic."
    echo "  Rollback:  ${COMPOSE} down ; restore DB from the pre-deploy backup if needed."
    exit 1
fi

echo "→ Service status:"
${COMPOSE} ps

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Deployment complete!"
echo ""
echo "  https://app.addxintelligence.com  → Backoffice"
echo "  https://pos.addxintelligence.com  → POS (iPad)"
echo "  https://m.addxintelligence.com    → Mobile Inventaire"
echo "  https://api.addxintelligence.com  → API Backend"
echo "═══════════════════════════════════════════════════════════════"
