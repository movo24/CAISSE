# Monitoring & DNS Cutover Playbook

> Période : surveillance 24h sur l'URL Railway native AVANT cutover DNS.

---

## 1 — Endpoint `/api/health` (déjà existant, vérifié)

**Path** : `/api/health` (exposé publiquement, sans auth)
**Méthode** : `GET`
**Réponse OK** : HTTP 200 + JSON avec `"status":"ok"`
**Réponse DB down** : HTTP 503 + JSON avec `"status":"down"`
**Réponse Redis/TimeWin down** : HTTP 200 + `"status":"degraded"`

### Échantillon réel de réponse OK (capturé 2026-05-10 12:14)

```json
{
  "status": "ok",
  "version": "1.1.0",
  "timestamp": "2026-05-10T10:14:18.755Z",
  "uptime_seconds": 14,
  "database": "up",
  "database_latency_ms": 153,
  "database_error": null,
  "redis": "unknown",
  "fallback_active": false,
  "redis_error": null,
  "redis_down_since": null,
  "timewin": "up",
  "circuit_breaker": "CLOSED",
  "memory": { "rss_mb": 90, "heap_used_mb": 42, "heap_total_mb": 47 },
  "recent_alerts": []
}
```

### Comportement attendu pour chaque champ

| Champ | OK | Dégradé | Down |
|---|---|---|---|
| `status` | `"ok"` | `"degraded"` | `"down"` |
| HTTP code | 200 | 200 | **503** |
| `database` | `"up"` | — | `"down"` |
| `database_latency_ms` | < 500 typique, < 5000 max | 500-5000 (Neon cold) | timeout / null |
| `redis` | `"up"` ou `"unknown"` (si pas de Redis) | `"down"` | — |
| `timewin` | `"up"` | `"degraded"` | `"down"` |
| `memory.rss_mb` | < 200 typique | 200-400 surveiller | > 500 alert |
| `uptime_seconds` | croît | reset = restart pod | — |

---

## 2 — Commandes curl exactes

### URL Railway native (tester maintenant et pendant 24h)

```bash
curl -sS https://caisse-backend-production.up.railway.app/api/health | jq
```

Avec status code visible :

```bash
curl -sS -o /dev/null -w "HTTP=%{http_code} time=%{time_total}s\n" \
  --max-time 10 https://caisse-backend-production.up.railway.app/api/health
```

Test 10 appels d'affilée (utilisé pour mesurer stabilité) :

```bash
URL=https://caisse-backend-production.up.railway.app
for i in $(seq 1 10); do
  curl -sS -o /dev/null -w "$i: HTTP=%{http_code} time=%{time_total}s\n" --max-time 10 "$URL/api/health"
  sleep 5
done
```

### Future URL `api.addxintelligence.com` (à utiliser APRÈS cutover DNS)

```bash
curl -sS https://api.addxintelligence.com/api/health | jq
```

Avec vérification que ça pointe bien vers Railway et pas vers l'ancien (test à faire DURANT le cutover) :

```bash
# 1. DNS doit résoudre vers Railway
dig +short api.addxintelligence.com
# Attendu (en final) : caisse-backend-production.up.railway.app. + IP

# 2. HTTP doit répondre 200 + JSON status:ok
curl -sS https://api.addxintelligence.com/api/health | jq

# 3. Header doit indiquer railway-edge
curl -sSI https://api.addxintelligence.com/api/health | grep -i "server"
# Attendu : server: railway-edge
```

---

## 3 — Critères GO / NO-GO pour cutover DNS

### ✅ GO (tous doivent être verts)

| # | Critère | Comment vérifier |
|---|---|---|
| 1 | **HTTP 200** stable sur 24h consécutives | UptimeRobot → 100% uptime depuis 24h |
| 2 | **Aucun deploy FAILED** depuis le dernier SUCCESS | Railway dashboard → Deployments → tous SUCCESS ou Active |
| 3 | **Aucun restart de pod** non-prévu | Railway → Metrics → graph "Deploys" plat |
| 4 | **Memory < 200 MB** stable | `/api/health` → `memory.rss_mb` ne monte pas en escalier |
| 5 | **DB latency < 500 ms** typique | `/api/health` → `database_latency_ms` |
| 6 | **Aucune erreur "ERROR" dans Deploy Logs** ces 24h | Railway → Deploy Logs → filtre "ERROR" → 0 entrée non-attendue |
| 7 | **E2E Wesley Club passent** : register → login → /me → /loyalty-card | Snippet smoke ci-dessous |
| 8 | **Frontends pointent déjà** vers `api.addxintelligence.com` | Déjà confirmé : tous les `VITE_API_URL` = `api.addxintelligence.com` |
| 9 | **Tu as un plan rollback** prêt à coller | Section 4 ci-dessous |

### Snippet smoke E2E à exécuter avant le GO

```bash
URL=https://caisse-backend-production.up.railway.app
RAND="prego-$(date +%s)@test.example"

echo "1. Health"
curl -sS -o /dev/null -w "  HTTP=%{http_code}\n" "$URL/api/health"

echo "2. Register"
RESP=$(curl -sS -X POST "$URL/api/mobile/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$RAND\",\"password\":\"smoketest1234\",\"firstName\":\"PreGo\"}")
echo "  → $(echo $RESP | head -c 80)..."
JWT=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('accessToken',''))")

echo "3. Login"
curl -sS -o /dev/null -w "  HTTP=%{http_code}\n" -X POST "$URL/api/mobile/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$RAND\",\"password\":\"smoketest1234\"}"

echo "4. /me with JWT"
curl -sS -o /dev/null -w "  HTTP=%{http_code}\n" "$URL/api/mobile/me" \
  -H "Authorization: Bearer $JWT"

echo "5. /loyalty-card with JWT"
curl -sS -o /dev/null -w "  HTTP=%{http_code}\n" "$URL/api/mobile/loyalty-card" \
  -H "Authorization: Bearer $JWT"
```

Tous doivent être 200 (sauf register = 201).

### ❌ NO-GO (tout déclenche le report)

- Un seul des 9 critères ci-dessus n'est pas vert
- Tu n'as pas testé le rollback dans ta tête
- Tu n'as pas un fenêtre de 30 min disponible pour réagir
- Trafic réel élevé prévu dans l'heure qui suit (impact maximal en cas de souci)
- Cloudflare DNS panel n'est pas accessible

---

## 4 — Rollback exact en cas d'échec DNS

### Symptôme A : `api.addxintelligence.com/api/health` retourne 502 / timeout / erreur Cloudflare

**Cause probable** : DNS propagé mais Railway n'a pas encore validé le custom domain (cert Let's Encrypt en cours).

**Action** : attendre 5 min, refaire `curl`. Si persiste >10 min :

```bash
# Vérifier l'état du custom domain dans Railway
TOKEN=4714644a-57f8-47e1-a022-a8d9570e79ad
curl -sS -X POST https://backboard.railway.app/graphql/v2 \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"{ service(id:\"a7b2748a-6000-4a32-802b-0e9319287f43\") { customDomains { domain status } } }"}'
```

Si status n'est pas `READY` : revoir le CNAME Cloudflare.

### Symptôme B : DNS résolu mais HTTP 4xx / 5xx persistant >5 min

**Action — rollback DNS** :

1. **Cloudflare** → zone `addxintelligence.com` → DNS → record `api`
2. Note le NOUVEAU target (Railway natif) avant de le changer — pour debug post-mortem
3. **Suppression** : delete le record `api` (le frontend cassera proprement avec DNS_PROBE_FINISHED_NXDOMAIN, ce qui est plus clair qu'un 502 cyclique)
4. Annonce immédiate : "DNS rolled back, backend toujours accessible sur l'URL Railway native, on diagnostique"

### Symptôme C : DNS OK + HTTP OK mais frontends cassent (CORS / auth)

**Causes possibles** :
- `CORS_ORIGIN` ne contient pas le domaine frontend
- Les sessions JWT ont expiré et le refresh boucle (cookies en cross-domain)

**Action** :

```bash
# Vérifier preflight CORS depuis pos.addxintelligence.com
curl -sSI -X OPTIONS https://api.addxintelligence.com/api/health \
  -H "Origin: https://pos.addxintelligence.com" \
  -H "Access-Control-Request-Method: GET"
# Attendu : 204 + access-control-allow-origin: https://pos.addxintelligence.com
```

Si CORS bloque, mettre à jour la var sur Railway et redeploy :

```bash
# variableUpsert pour CORS_ORIGIN avec la liste correcte
```

### Pas de rollback "vers l'ancien backend"

⚠️ L'ancien Railway service est **supprimé**. Il n'y a pas de "version précédente" qui marche. Le rollback DNS = "DNS pointe vers rien" → frontends affichent une erreur claire de connexion. Tu fixes, tu re-cutover.

C'est pour ça qu'on stabilise 24h **AVANT** le cutover.

---

## 5 — UptimeRobot — config exacte à créer

### Compte
- https://uptimerobot.com → **Sign Up** (free, 50 monitors @ 5 min interval)
- Email = ton email où tu veux les alertes

### Monitor #1 (à créer maintenant)

| Champ | Valeur exacte |
|---|---|
| **Type** | `HTTPS` |
| **Friendly Name** | `CAISSE Backend (Railway native)` |
| **URL** | `https://caisse-backend-production.up.railway.app/api/health` |
| **Monitoring Interval** | `5 minutes` (max free) |
| **Monitor Timeout** | `30 seconds` |
| **HTTP Method** | `GET` |
| **Authentication** | None |
| **Custom HTTP Headers** | None |

### ⚠️ Section CRITIQUE — Keyword check

**Active la "Keyword Monitoring"** (sous "Advanced Settings") :

| Champ | Valeur |
|---|---|
| **Keyword Type** | `should EXIST` |
| **Keyword Value** | `"status":"ok"` (avec guillemets, c'est une chaîne JSON) |
| **Case Sensitive** | OUI |

Pourquoi : sans keyword check, UptimeRobot considère "200 OK" suffisant. Avec keyword, il alerte aussi sur `status:degraded` ou `status:down` même si HTTP=200.

### Alert Contacts à attacher au monitor

- Email principal : OUI
- (Optionnel) Slack webhook : si tu as un workspace
- SMS : seulement si free tier l'autorise (je crois pas, sinon paid)

### Critères d'alerte critiques (à reconnaître quand UptimeRobot t'écrit)

| Alerte UptimeRobot | Sévérité | Action |
|---|---|---|
| **"Down — Couldn't connect"** | 🔴 P0 | Pod Railway crashé. Check Railway dashboard immédiatement. |
| **"Down — HTTP 503"** | 🔴 P0 | DB Neon down. Check Neon dashboard. |
| **"Down — Keyword 'status\:ok' not found"** | 🟠 P1 | Backend répond mais en mode dégradé (Redis ou TimeWin down). Pas une panne totale mais à investiguer. |
| **"Down — HTTP 502 / 504"** | 🔴 P0 | Container vivant mais ne répond pas. Probable crash interne ou port mismatch. |
| **"Down — Timeout"** | 🟠 P1 | Latence excessive (>30s). Probable cold-start anormalement long. Si ça persiste : investigate. |

### Monitor #2 (à créer APRÈS cutover DNS)

Identique au #1 mais URL = `https://api.addxintelligence.com/api/health`.

Garde les DEUX monitors actifs après cutover, pour détecter si Cloudflare/DNS pose problème indépendamment du backend.

---

## 6 — Critère de fin de cette phase (rappel)

Avant que je puisse exécuter le cutover DNS sur ton ordre, ces 6 lights doivent être vertes :

- [ ] ✅ Backend stable sur `caisse-backend-production.up.railway.app` (24h continu, déjà 200 vérifié)
- [ ] ✅ `/api/health` répond `status:ok` (timeout DB ping élargi à 5s, plus de faux positifs Neon cold-start)
- [ ] ⏳ Railway logs propres pendant 24h (à observer)
- [ ] ⏳ UptimeRobot actif (action user manuelle, ~5 min)
- [ ] ✅ DNS-CUTOVER-CHECKLIST.md committé (`fdd1ffb`)
- [ ] ✅ Rollback documenté (Section 4 ci-dessus)

Quand les 4 cases ⏳ deviennent ✅ → tu me dis **"GO DNS"** et j'exécute la `DNS-CUTOVER-CHECKLIST.md`.

Aucun cutover sans ce GO explicite.

---

## 8 — Checklist monitoring pré-prod (P293, bloc B6 — rien de connecté, valeurs prêtes à coller)

### 8.1 UptimeRobot (ou équivalent) — moniteurs à créer

| # | Type | Cible | Réglage | Alerte si |
|---|---|---|---|---|
| 1 | HTTP(s) keyword | `https://api.addxintelligence.com/api/health` (après cutover ; avant : URL Railway) | interval 60 s, keyword **`"status":"ok"`** (alert aussi sur `degraded` via moniteur 2) | keyword absent OU code ≠ 200 |
| 2 | HTTP(s) keyword | même URL | interval 5 min, keyword **`"status":"degraded"`**, type « exists » | présent → Redis ou TW24 down (non bloquant, à investiguer) |
| 3 | HTTP(s) | `https://app.addxintelligence.com` | interval 5 min | code ≠ 200 |
| 4 | HTTP(s) | `https://pos.addxintelligence.com` | interval 5 min | code ≠ 200 |
| 5 | SSL expiry | les 4 domaines | alerte à J-14 | certificat < 14 j |

Contacts d'alerte : email + (optionnel) webhook → même canal que `ALERT_WEBHOOK_URL`.

### 8.2 Alerting applicatif (déjà codé — à activer par UNE variable)

- `ALERT_WEBHOOK_URL` (Slack/Discord/custom) → `AlertService` pousse : `REDIS_DOWN/RECOVERED`, `TIMEWIN_DOWN/RECOVERED`, `CIRCUIT_BREAKER_OPEN/CLOSED`, `LOGIN_BRUTEFORCE`, `RATE_LIMIT_BURST`. Sans la variable : logs structurés seulement (comportement actuel).
- `SENTRY_DSN` → erreurs runtime (déjà câblé dans `main.ts`, no-op sans DSN).

### 8.3 Healthchecks par environnement

| Env | Mécanisme | Où |
|---|---|---|
| Railway | healthcheck HTTP `/api/health` (503 = restart) | service settings (déjà en place) |
| docker-compose | `pg_isready` + `wget /api/health` (déjà dans le compose) + attente réelle dans `deploy.sh` | `docker/docker-compose.prod.yml` |
| Cron externe | moniteurs §8.1 | UptimeRobot |

### 8.4 Logs — quoi regarder chaque semaine (5 min)

```bash
# docker path :
docker compose -f docker/docker-compose.prod.yml logs backend --since 168h 2>&1 | \
  grep -E "ERROR|WARN" | grep -vE "TW24_PUSH_FAILED.*circuit" | sort | uniq -c | sort -rn | head -20
# Railway : dashboard → Deployments → View logs, filtrer ERROR.
```
Signaux à traiter : `LOGIN_BRUTEFORCE` (répété = attaque), `CIRCUIT_BREAKER_OPEN` persistant (TW24 réellement down), `Publish … → HTTP` non-2xx récurrent (receveur outbox malade → vérifier `GET /api/integration/outbox/stats`, `failed` doit rester 0), croissance de `pending` outbox (relais arrêté).

### 8.5 Ce qui reste volontairement NON connecté ici
Aucun compte UptimeRobot/Sentry/webhook n'est créé ni configuré depuis le dépôt — ce sont des actions console à faire par un humain avec les valeurs ci-dessus (zéro secret dans le repo).
