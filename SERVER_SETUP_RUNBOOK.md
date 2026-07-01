# SERVER_SETUP_RUNBOOK.md — Mise en service d'un serveur CAISSE de zéro (procédure humaine)

> P294 (bloc B7) — 2026-07-02. Chemin **docker-compose autogéré** (le chemin Railway/Neon actuel est couvert par `packages/backend/RUNBOOK.md`). Chaque commande est copiable telle quelle. Durée totale ≈ 30-45 min.
> ⚠️ Ne JAMAIS exécuter sur le serveur qui héberge Backend A (`api.addxintelligence.com`) sans GO explicite.

## 0. Prérequis

- Un serveur Ubuntu 22.04+ (2 vCPU / 4 Go RAM / 40 Go disque minimum), accès SSH root ou sudo.
- Les DNS des 4 sous-domaines pointés vers l'IP du serveur (A records) : `api.` `app.` `pos.` `m.` — **seulement au moment du cutover, pas avant** (cf. `DNS-CUTOVER-CHECKLIST.md`).
- Le fichier `pos-recovery.bundle` (ou un accès git au dépôt).

## 1. Provision & Docker (une fois)

```bash
ssh user@SERVEUR
sudo apt-get update && sudo apt-get upgrade -y
# Docker officiel + compose plugin :
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker
docker --version && docker compose version   # attendu : Docker 24+, compose v2+
# Pare-feu minimal :
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable
```

## 2. Copier le projet

Option bundle (recommandé, pas de push distant nécessaire) :
```bash
# Depuis ta machine :
scp pos-recovery.bundle user@SERVEUR:~/
# Sur le serveur :
git clone ~/pos-recovery.bundle ~/CAISSE -b recovery/pos-audit-session
cd ~/CAISSE && git log --oneline -1   # vérifier le commit attendu
```
Option git : `git clone <repo> ~/CAISSE && cd ~/CAISSE && git checkout recovery/pos-audit-session`.

## 3. Configurer `.env` (les SEULS secrets, jamais commités)

```bash
cd ~/CAISSE
cp docker/.env.production.example docker/.env.production
nano docker/.env.production
```
À remplir obligatoirement :
- `DB_USER` / `DB_PASSWORD` (Postgres du compose) — `openssl rand -hex 16` pour le mot de passe.
- `JWT_SECRET` et `JWT_REFRESH_SECRET` — **différents**, `openssl rand -hex 32` chacun.
- `CORS_ORIGIN` — liste explicite (`https://app.addxintelligence.com,https://pos.addxintelligence.com,https://m.addxintelligence.com`), jamais `*`.
- Optionnels mais recommandés : `ALERT_WEBHOOK_URL`, `SENTRY_DSN` (cf. MONITORING-PLAYBOOK §8).
- Gates : laisser `OUTBOX_RELAY_ENABLED` absent/false tant que GATE 1 n'est pas fournie.

## 4. Preflight (échoue = on n'avance pas)

```bash
cd ~/CAISSE && npm install --omit=optional 2>/dev/null || true   # uniquement pour le preflight local
bash scripts/preflight.sh          # attendu : OVERALL PASS
```

## 5. Déployer

```bash
./docker/deploy.sh
# Le script enchaîne : preflight → confirmation tapée "deploy" → backup (si DB déjà lancée)
# → build → up -d → attente healthcheck réelle (120 s max) → smoke tests → statut.
```
Les migrations TypeORM se jouent automatiquement au boot du backend (`migrationsRun` en prod).

## 6. Smoke manuel complémentaire (2 min)

```bash
docker exec caisse-backend wget -qO- http://localhost:3001/api/health   # {"status":"ok",...}
docker compose -f docker/docker-compose.prod.yml ps                     # tous Up/healthy
# Puis la checklist complète : packages/backend/RUNBOOK.md §Smoke test checklist.
```

## 7. SSL (première fois seulement)

```bash
./docker/init-ssl.sh    # certbot ; nécessite les DNS déjà pointés + port 80 ouvert
```

## 8. Backup & restore

```bash
./docker/backup.sh                 # dump compressé + intégrité + rétention 14 → docker/backups/
./docker/backup.sh list
./docker/backup.sh restore docker/backups/caisse-YYYYMMDD-HHMMSS.sql.gz   # confirmation tapée
# Automatiser : crontab -e →  0 3 * * * cd ~/CAISSE && ./docker/backup.sh >> /var/log/caisse-backup.log 2>&1
```

## 9. Rollback

| Situation | Action |
|---|---|
| Déploiement raté (healthcheck/smoke FAIL) | `docker compose -f docker/docker-compose.prod.yml down` puis redéployer le commit précédent (`git checkout <sha> && ./docker/deploy.sh`) |
| Données corrompues | `./docker/backup.sh restore <dernier dump sain>` |
| Cutover DNS raté | rollback DNS (cf. `MONITORING-PLAYBOOK.md` §4) |

## 10. Erreurs fréquentes

| Symptôme | Cause | Correction |
|---|---|---|
| Boot crash « Missing required environment variables » | `.env.production` incomplet | remplir `DATABASE_URL`/`JWT_*` (§3) |
| Boot crash « JWT_SECRET must be at least 32 characters » | secret trop court | `openssl rand -hex 32` |
| Boot prod crash « REDIS_URL must be set » | prod sans Redis | fournir `REDIS_URL` ou `ALLOW_INMEMORY_CACHE=true` (mono-instance uniquement) |
| Boot prod crash « CORS_ORIGIN » | CORS absent ou `*` | liste explicite (§3) |
| Backend unhealthy en boucle | DB pas prête / mauvais `DB_PASSWORD` | `docker compose logs postgres backend` |
| `POST /api/stores/sync` → `total: 0` | secrets TW24 absents | poser `TIMEWIN24_POS_SECRET`/`TIMEWIN24_API_KEY` |
| Certbot échoue | DNS pas encore propagé / port 80 fermé | `dig api.addxintelligence.com` + ufw |
| Outbox `pending` s'accumule | relais OFF (normal sans GATE 1) | attendu ; sinon voir `OUTBOX_RELAY_KIT.md` |

## 11. Après mise en service

1. Créer les moniteurs UptimeRobot (`MONITORING-PLAYBOOK.md` §8.1).
2. Vérifier le cron backup (§8).
3. Archiver un bundle hors serveur : `git bundle create /backup/pos-$(date +%F).bundle --all`.
