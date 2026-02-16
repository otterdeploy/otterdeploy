#!/usr/bin/env bash
set -euo pipefail

CAST_PATTERN='\sas\s(any|never(\[\])?)\b|\sas\stypeof\s.*\$inferSelect'
TRY_CATCH_PATTERN='\btry\s*\{|catch\s*\('

cast_matches="$(rg -n "$CAST_PATTERN" packages apps \
  --glob '!**/routeTree.gen.ts' \
  --glob '!**/*.gen.ts' || true)"

if [[ -n "$cast_matches" ]]; then
  echo "[result-discipline] Unsafe casts are not allowed outside generated files:"
  echo "$cast_matches"
  exit 1
fi

try_catch_matches="$(rg -n "$TRY_CATCH_PATTERN" \
  packages/domain/src \
  packages/secrets/src \
  packages/events/src \
  packages/api/src/routers || true)"

if [[ -n "$try_catch_matches" ]]; then
  echo "[result-discipline] Raw try/catch is not allowed in enforced layers:"
  echo "$try_catch_matches"
  exit 1
fi

echo "[result-discipline] ok"
