#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# GATE 2 — Jouer les migrations 1725 + 1726 + 1727 sur la base cible.
# GO utilisateur enregistré le 2026-07-02 (EXECUTION_LOG P350).
#
# Usage (depuis la racine du repo, sur une machine qui ATTEINT la base) :
#   DATABASE_URL="postgresql://...neon.tech/...?sslmode=require" ./scripts/run-gate2.sh
#
# Le script s'arrête à la PREMIÈRE anomalie (set -e) et n'écrit RIEN tant que
# le backup n'est pas fait et vérifié. Tout est celui du MIGRATION_RUNBOOK.md,
# juste enchaîné et vérifié automatiquement.
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "❌ DATABASE_URL manquant. Fournis l'URL de la base CIBLE (Neon) :"
  echo '   DATABASE_URL="postgresql://..." ./scripts/run-gate2.sh'
  exit 1
fi
if [[ "$DATABASE_URL" == *"localhost"* || "$DATABASE_URL" == *"127.0.0.1"* ]]; then
  echo "⚠️  DATABASE_URL pointe sur localhost — ce n'est PAS la base cible GATE 2."
  read -r -p "Continuer quand même (dev local) ? [y/N] " ok
  [[ "$ok" == "y" ]] || exit 1
fi
command -v psql >/dev/null    || { echo "❌ psql introuvable (brew install libpq / apt install postgresql-client)"; exit 1; }
command -v pg_dump >/dev/null || { echo "❌ pg_dump introuvable"; exit 1; }

echo "── A. BACKUP (non négociable) ──────────────────────────────────────────"
DUMP="pre-gate2-$(date +%Y%m%d-%H%M).dump"
pg_dump "$DATABASE_URL" --no-owner -Fc -f "$DUMP"
[[ -s "$DUMP" ]] || { echo "❌ dump vide"; exit 1; }
pg_restore --list "$DUMP" > /dev/null || { echo "❌ dump illisible"; exit 1; }
echo "✅ Backup OK : $DUMP ($(du -h "$DUMP" | cut -f1))"

echo "── B. ÉTAT AVANT ───────────────────────────────────────────────────────"
LAST=$(psql "$DATABASE_URL" -tAc "SELECT name FROM migrations ORDER BY timestamp DESC LIMIT 1;")
echo "Dernière migration en base : $LAST"
if [[ "$LAST" == *"1727"* ]]; then echo "✅ 1727 déjà jouée — rien à faire."; exit 0; fi
if [[ "$LAST" != *"1724"* && "$LAST" != *"1725"* && "$LAST" != *"1726"* ]]; then
  echo "❌ Tête inattendue ($LAST ≠ 1724/25/26) — vérifie que c'est la bonne base. STOP."
  exit 1
fi
SALES_BEFORE=$(psql "$DATABASE_URL" -tAc "SELECT COUNT(*) FROM sales;")
echo "Ventes avant : $SALES_BEFORE"
PSID=$(psql "$DATABASE_URL" -tAc "SELECT COUNT(*) FROM information_schema.columns WHERE table_name='sales' AND column_name='pos_session_id';")
echo "Colonne pos_session_id présente : $PSID (attendu 0)"

echo "── C. MIGRATION ────────────────────────────────────────────────────────"
( cd "$(dirname "$0")/../packages/backend" && DATABASE_URL="$DATABASE_URL" npm run migration:run )

echo "── D. CONTRÔLES POST-MIGRATION ─────────────────────────────────────────"
FAIL=0
check() { # label attendu requête
  local got; got=$(psql "$DATABASE_URL" -tAc "$3")
  if [[ "$got" == "$2" ]]; then echo "✅ $1 = $got"; else echo "❌ $1 = $got (attendu $2)"; FAIL=1; fi
}
check "integration_events (table neuve, vide)" "0" "SELECT COUNT(*) FROM integration_events;"
check "sales.pos_session_id non-NULL (legacy)" "0" "SELECT COUNT(*) FROM sales WHERE pos_session_id IS NOT NULL;"
check "COUNT(sales) inchangé" "$SALES_BEFORE" "SELECT COUNT(*) FROM sales;"
check "suppliers (table neuve, vide)" "0" "SELECT COUNT(*) FROM suppliers;"
NEWLAST=$(psql "$DATABASE_URL" -tAc "SELECT name FROM migrations ORDER BY timestamp DESC LIMIT 1;")
echo "Tête migrations : $NEWLAST"
[[ "$NEWLAST" == *"1727"* ]] || { echo "❌ 1727 pas en tête"; FAIL=1; }

if [[ $FAIL -eq 0 ]]; then
  echo ""
  echo "════ GATE 2 : SUCCÈS ✅ — garde le dump $DUMP quelques jours. ════"
  echo "Rollback si besoin : cd packages/backend && npm run migration:revert (×3, cf MIGRATION_RUNBOOK §3)"
else
  echo ""
  echo "════ ⚠️ CONTRÔLES EN ÉCHEC — NE PAS déployer. Voir MIGRATION_RUNBOOK §3 (rollback) ════"
  exit 1
fi
