#!/bin/bash
# ── deploy.sh — Deploy CAISSE to production ─────────────────────
# Usage: chmod +x docker/deploy.sh && ./docker/deploy.sh
# ─────────────────────────────────────────────────────────────────

set -e

COMPOSE_FILE="docker/docker-compose.prod.yml"
ENV_FILE="docker/.env.production"

echo "═══════════════════════════════════════════════════════════════"
echo "  CAISSE — Production Deployment"
echo "  Domain: addxintelligence.com"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Check env file exists
if [ ! -f "$ENV_FILE" ]; then
    echo "ERROR: ${ENV_FILE} not found!"
    echo "Copy docker/.env.production.example to docker/.env.production"
    echo "and fill in your values."
    exit 1
fi

# Build & deploy
echo "→ Building all services..."
docker compose -f ${COMPOSE_FILE} --env-file ${ENV_FILE} build

echo ""
echo "→ Starting services..."
docker compose -f ${COMPOSE_FILE} --env-file ${ENV_FILE} up -d

echo ""
echo "→ Waiting for services to be healthy..."
sleep 10

echo ""
echo "→ Service status:"
docker compose -f ${COMPOSE_FILE} ps

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Deployment complete!"
echo ""
echo "  https://app.addxintelligence.com  → Backoffice"
echo "  https://pos.addxintelligence.com  → POS (iPad)"
echo "  https://m.addxintelligence.com    → Mobile Inventaire"
echo "  https://api.addxintelligence.com  → API Backend"
echo "═══════════════════════════════════════════════════════════════"
