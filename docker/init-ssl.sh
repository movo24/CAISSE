#!/bin/bash
# ── init-ssl.sh — First-time SSL setup with Let's Encrypt ──────
# Run this ONCE on the server after DNS is configured
# Usage: chmod +x docker/init-ssl.sh && ./docker/init-ssl.sh
# ─────────────────────────────────────────────────────────────────

set -e

DOMAIN="addxintelligence.com"
EMAIL="contact@addxintelligence.com"  # Change to your email
COMPOSE_FILE="docker/docker-compose.prod.yml"

echo "═══════════════════════════════════════════════════════════════"
echo "  SSL Setup for ${DOMAIN}"
echo "═══════════════════════════════════════════════════════════════"

# Step 1: Create temporary nginx config (HTTP only, for ACME challenge)
echo "→ Creating temporary nginx config for ACME challenge..."

cat > /tmp/nginx-acme.conf << 'NGINX'
server {
    listen 80;
    server_name addxintelligence.com *.addxintelligence.com;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 200 'CAISSE — SSL setup in progress';
        add_header Content-Type text/plain;
    }
}
NGINX

# Step 2: Start nginx with temp config
echo "→ Starting nginx for ACME verification..."
docker compose -f ${COMPOSE_FILE} run -d \
  --name caisse-nginx-temp \
  -p 80:80 \
  -v /tmp/nginx-acme.conf:/etc/nginx/conf.d/default.conf:ro \
  -v caisse_certbot_www:/var/www/certbot \
  nginx:alpine

sleep 3

# Step 3: Request certificate (wildcard + root)
echo "→ Requesting Let's Encrypt certificate..."
docker run --rm \
  -v caisse_certbot_conf:/etc/letsencrypt \
  -v caisse_certbot_www:/var/www/certbot \
  certbot/certbot certonly \
    --webroot \
    --webroot-path=/var/www/certbot \
    --email ${EMAIL} \
    --agree-tos \
    --no-eff-email \
    -d ${DOMAIN} \
    -d api.${DOMAIN} \
    -d app.${DOMAIN} \
    -d pos.${DOMAIN} \
    -d m.${DOMAIN}

# Step 4: Cleanup temp nginx
echo "→ Cleaning up temporary nginx..."
docker stop caisse-nginx-temp 2>/dev/null || true
docker rm caisse-nginx-temp 2>/dev/null || true

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  SSL certificate obtained!"
echo "  Now start the full stack:"
echo ""
echo "  docker compose -f docker/docker-compose.prod.yml \\"
echo "    --env-file docker/.env.production up -d --build"
echo "═══════════════════════════════════════════════════════════════"
