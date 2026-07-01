#!/usr/bin/env bash
# POS-INT-216 — resume preflight: one-command LOCAL readiness check.
# Zero secret, zero prod, zero network. Structural checks by default;
# add --full to also run tsc + targeted tests (slower).
# Classification rules mirror src/common/config/preflight-checks.ts (tested).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BE="$ROOT/packages/backend"
FULL=0; [ "${1:-}" = "--full" ] && FULL=1

fails=0; warns=0
line() { printf '%-42s %s\n' "$1" "$2"; }

echo "== POS resume preflight =="

# 1. .env.example completeness (used-but-undocumented = FAIL)
used=$(grep -rhoE "process\.env\.[A-Z0-9_]+" "$BE/src" --include="*.ts" 2>/dev/null | grep -v spec | sed -E 's/process\.env\.//' | sort -u)
documented=$(grep -oE "^[A-Z0-9_]+=" "$BE/.env.example" 2>/dev/null | sed 's/=//' | sort -u)
missing=$(comm -23 <(echo "$used") <(echo "$documented"))
if [ -z "$missing" ]; then line "env.example completeness" "PASS"; else line "env.example completeness" "FAIL ($(echo "$missing" | tr '\n' ' '))"; fails=$((fails+1)); fi

# 2. Required keys documented
for k in DATABASE_URL JWT_SECRET JWT_REFRESH_SECRET NODE_ENV; do
  echo "$documented" | grep -qx "$k" || { line "required key $k" "FAIL"; fails=$((fails+1)); }
done
[ "$fails" -eq 0 ] && line "required keys documented" "PASS"

# 3. Key resume/gate docs present
for d in OUTBOX_RELAY_KIT.md EXTERNAL_GATES_RUNBOOK.md RESUME_CHECKLIST.md; do
  [ -f "$ROOT/$d" ] && line "doc $d" "PASS" || { line "doc $d" "WARN (absent)"; warns=$((warns+1)); }
done

# 4. Gates stay OFF by default (no accidental activation) — WARN if enabled locally
if [ "${OUTBOX_RELAY_ENABLED:-false}" = "true" ]; then line "OUTBOX relay flag" "WARN (enabled in env)"; warns=$((warns+1)); else line "OUTBOX relay flag" "PASS (off)"; fi
if [ "${SOCIAL_ENTRIES_ENABLED:-false}" = "true" ]; then line "social entries flag" "WARN (enabled in env)"; warns=$((warns+1)); else line "social entries flag" "PASS (off)"; fi

# 5. Optional heavy checks
if [ "$FULL" -eq 1 ]; then
  ( cd "$BE" && npx tsc --noEmit >/dev/null 2>&1 ) && line "backend tsc --noEmit" "PASS" || { line "backend tsc --noEmit" "FAIL"; fails=$((fails+1)); }
  ( cd "$BE" && npx jest src/common/config src/modules/integration/outbox-publisher.spec.ts test/migration-1725-dryrun.spec.ts src/modules/comptamax/social-entries-guard.spec.ts --silent >/dev/null 2>&1 ) \
    && line "targeted gate + env tests" "PASS" || { line "targeted gate + env tests" "FAIL"; fails=$((fails+1)); }
else
  line "heavy checks (tsc/tests)" "SKIPPED (use --full)"
fi

echo "-------------------------------------------"
if [ "$fails" -gt 0 ]; then echo "OVERALL: FAIL ($fails fail, $warns warn)"; exit 1;
elif [ "$warns" -gt 0 ]; then echo "OVERALL: WARN ($warns warn)"; exit 0;
else echo "OVERALL: PASS"; exit 0; fi
