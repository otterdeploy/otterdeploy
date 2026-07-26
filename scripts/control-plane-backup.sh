#!/usr/bin/env bash
#
# otterdeploy control-plane backup — od-5j8.13
# --------------------------------------------
# Backs up the CONTROL PLANE itself (not tenant databases — those already have
# their own backup engine, see packages/api/src/routers/backups/). This is
# what a bare-metal / clean-server disaster-recovery restore needs:
#
#   1. The control-plane Postgres database (pg_dump, custom format).
#   2. Config: $INSTALL_DIR/.env (holds POSTGRES_*, BETTER_AUTH_SECRET,
#      DATA_ENCRYPTION_KEYS — the keyring, see packages/api/src/lib/crypto.ts)
#      and the compose file that describes the stack.
#   3. Caddy state: the `otterdeploy-caddy-data` (ACME account + certs) and
#      `otterdeploy-caddy-state` (Caddy's own storage) named volumes — losing
#      these means re-issuing every certificate on restore.
#
# Deliberately NOT included: redis (ephemeral BullMQ job state — losing it
# means re-triggering in-flight jobs, not data loss) and crowdsec state
# (threat-intel cache that rebuilds itself). Neither is in od-5j8.13's scope.
#
# The whole archive is encrypted with a RECOVERY KEY that is independent of
# the keyring it contains (see scripts/lib/recovery-key.mjs and
# packages/api/src/lib/recovery-key.ts for why: a backup encrypted with a key
# that only exists on the dying server is worthless). Generate one with
# `otterdeploy backups control-plane generate-key` (or `otterdeploy
# recovery-key generate` offline) and set OTTERDEPLOY_RECOVERY_KEY before
# running this script — see docs/designs/control-plane-disaster-recovery.md.
#
# Usage:
#   OTTERDEPLOY_RECOVERY_KEY=<64-hex-key> \
#   OTTERDEPLOY_CP_BACKUP_S3_BUCKET=... \
#   OTTERDEPLOY_CP_BACKUP_S3_ENDPOINT=... \
#   OTTERDEPLOY_CP_BACKUP_S3_ACCESS_KEY_ID=... \
#   OTTERDEPLOY_CP_BACKUP_S3_SECRET_ACCESS_KEY=... \
#     sudo -E bash control-plane-backup.sh
#
# Tunables:
#   OTTERDEPLOY_DATA_DIR       host data folder    (default /data/otterdeploy)
#   OTTERDEPLOY_INSTALL_DIR    install root        (default $DATA_DIR/source)
#   OTTERDEPLOY_CP_BACKUP_S3_PREFIX   key prefix inside the bucket (default control-plane)
#   OTTERDEPLOY_CP_BACKUP_URL  control-plane URL used to report the run
#                              (default http://localhost:3000)
#   OTTERDEPLOY_CP_BACKUP_TOKEN  a CLI/API bearer token with install-admin
#                              authority, so this script can call
#                              backups.controlPlane.reportRun after a
#                              successful upload. Optional — if unset, the
#                              run still completes, it's just not reflected
#                              in the readiness UI until reported some other
#                              way (e.g. `otterdeploy backups control-plane`
#                              won't show it).
#   OTTERDEPLOY_DRY_RUN        true|false          (default false)

set -Eeuo pipefail

DATA_DIR="${OTTERDEPLOY_DATA_DIR:-/data/otterdeploy}"
INSTALL_DIR="${OTTERDEPLOY_INSTALL_DIR:-$DATA_DIR/source}"
ENV_FILE="$INSTALL_DIR/.env"
COMPOSE_FILE="$INSTALL_DIR/docker-compose.yml"
S3_PREFIX="${OTTERDEPLOY_CP_BACKUP_S3_PREFIX:-control-plane}"
CP_URL="${OTTERDEPLOY_CP_BACKUP_URL:-http://localhost:3000}"
DRY_RUN="${OTTERDEPLOY_DRY_RUN:-false}"
# Pinned to match apps/server/Dockerfile's BUN_VERSION — this image is
# fetched fresh (never assumes the otterdeploy image is present), so the two
# staying in lockstep just keeps behavior predictable, not load-bearing.
BUN_IMAGE="oven/bun:1.3.14-slim"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

say()  { printf '%s\n' "$*"; }
step() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
warn() { printf '\033[33mwarning:\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

[ -f "$ENV_FILE" ] || fail "no .env at $ENV_FILE — is this a control-plane host?"
[ -n "${OTTERDEPLOY_RECOVERY_KEY:-}" ] || fail "OTTERDEPLOY_RECOVERY_KEY is required — generate one with \`otterdeploy backups control-plane generate-key\`"
command -v docker >/dev/null 2>&1 || fail "docker is required"

# shellcheck source=/dev/null
set -a; source "$ENV_FILE"; set +a
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-postgres}"

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/otterdeploy-cp-backup.XXXXXX")"
cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

step "1/5 · Dumping control-plane Postgres"
if [ "$DRY_RUN" = "true" ]; then
  say "+ docker exec otterdeploy-postgres pg_dump -Fc -U $POSTGRES_USER $POSTGRES_DB > $WORKDIR/control-plane.pgdump"
else
  docker exec otterdeploy-postgres pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB" > "$WORKDIR/control-plane.pgdump"
  say "  $(du -h "$WORKDIR/control-plane.pgdump" | cut -f1) dump written"
fi

step "2/5 · Archiving config + Caddy state"
mkdir -p "$WORKDIR/config"
cp "$ENV_FILE" "$WORKDIR/config/.env"
[ -f "$COMPOSE_FILE" ] && cp "$COMPOSE_FILE" "$WORKDIR/config/docker-compose.yml"
if [ "$DRY_RUN" != "true" ]; then
  for volume in otterdeploy-caddy-data otterdeploy-caddy-state; do
    if docker volume inspect "$volume" >/dev/null 2>&1; then
      docker run --rm \
        -v "$volume:/from:ro" \
        -v "$WORKDIR:/to" \
        alpine tar czf "/to/${volume}.tar.gz" -C /from .
      say "  archived $volume"
    else
      warn "volume $volume not found — skipping (single-node install without Caddy?)"
    fi
  done
fi

step "3/5 · Combining into one archive"
ARCHIVE="$WORKDIR/control-plane.tar"
if [ "$DRY_RUN" != "true" ]; then
  tar -cf "$ARCHIVE" -C "$WORKDIR" \
    control-plane.pgdump \
    config \
    $(cd "$WORKDIR" && ls -- *.tar.gz 2>/dev/null || true)
  SIZE=$(stat -f%z "$ARCHIVE" 2>/dev/null || stat -c%s "$ARCHIVE")
  say "  $((SIZE / 1024 / 1024)) MiB combined archive"
fi

step "4/5 · Encrypting with the recovery key"
ENCRYPTED="$WORKDIR/control-plane.tar.enc"
if [ "$DRY_RUN" = "true" ]; then
  say "+ docker run --rm -v $WORKDIR:/data -v $SCRIPT_DIR/lib:/script:ro $BUN_IMAGE bun /script/recovery-key.mjs encrypt --in /data/control-plane.tar --out /data/control-plane.tar.enc"
else
  docker run --rm \
    -v "$WORKDIR:/data" \
    -v "$SCRIPT_DIR/lib:/script:ro" \
    -e "OTTERDEPLOY_RECOVERY_KEY=$OTTERDEPLOY_RECOVERY_KEY" \
    "$BUN_IMAGE" bun /script/recovery-key.mjs encrypt --in /data/control-plane.tar --out /data/control-plane.tar.enc
fi

step "5/5 · Uploading to off-host storage"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
REMOTE_KEY="$S3_PREFIX/control-plane-$TIMESTAMP.tar.enc"
UPLOAD_OK=false
UPLOAD_ERROR=""
if [ "$DRY_RUN" = "true" ]; then
  say "+ upload $ENCRYPTED -> s3://\${OTTERDEPLOY_CP_BACKUP_S3_BUCKET}/$REMOTE_KEY"
  UPLOAD_OK=true
elif [ -n "${OTTERDEPLOY_CP_BACKUP_S3_BUCKET:-}" ]; then
  # rclone's S3 backend needs no local config file — every parameter can ride
  # as a CLI flag, which keeps this script from having to template an rclone.conf.
  ENDPOINT_ARGS=()
  [ -n "${OTTERDEPLOY_CP_BACKUP_S3_ENDPOINT:-}" ] && ENDPOINT_ARGS+=(--s3-endpoint "$OTTERDEPLOY_CP_BACKUP_S3_ENDPOINT")
  if docker run --rm \
      -v "$WORKDIR:/data:ro" \
      rclone/rclone:latest \
      --s3-provider=Other \
      --s3-access-key-id="${OTTERDEPLOY_CP_BACKUP_S3_ACCESS_KEY_ID:-}" \
      --s3-secret-access-key="${OTTERDEPLOY_CP_BACKUP_S3_SECRET_ACCESS_KEY:-}" \
      --s3-region="${OTTERDEPLOY_CP_BACKUP_S3_REGION:-auto}" \
      "${ENDPOINT_ARGS[@]}" \
      copyto "/data/control-plane.tar.enc" ":s3:${OTTERDEPLOY_CP_BACKUP_S3_BUCKET}/${REMOTE_KEY}"; then
    UPLOAD_OK=true
  else
    UPLOAD_ERROR="rclone upload failed"
  fi
else
  UPLOAD_ERROR="no destination configured — set OTTERDEPLOY_CP_BACKUP_S3_BUCKET (+ _ENDPOINT/_ACCESS_KEY_ID/_SECRET_ACCESS_KEY)"
fi

if [ "$UPLOAD_OK" = "true" ]; then
  say "  uploaded to $REMOTE_KEY"
else
  warn "$UPLOAD_ERROR"
fi

# Report the run so the readiness surface (otterdeploy backups control-plane
# status) reflects reality. Best-effort: a reporting failure must not make an
# otherwise-successful backup look like nothing happened — see the warning.
if [ -n "${OTTERDEPLOY_CP_BACKUP_TOKEN:-}" ] && [ "$DRY_RUN" != "true" ]; then
  SIZE_BYTES=$(stat -f%z "$ENCRYPTED" 2>/dev/null || stat -c%s "$ENCRYPTED" 2>/dev/null || echo null)
  STATUS_JSON="succeeded"; ERROR_JSON="null"
  if [ "$UPLOAD_OK" != "true" ]; then STATUS_JSON="failed"; ERROR_JSON="\"$UPLOAD_ERROR\""; fi
  curl -fsS -X POST "$CP_URL/rpc/backups/controlPlane/reportRun" \
    -H "Authorization: Bearer $OTTERDEPLOY_CP_BACKUP_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"status\":\"$STATUS_JSON\",\"sizeBytes\":$SIZE_BYTES,\"error\":$ERROR_JSON}" \
    >/dev/null || warn "could not report the run to $CP_URL — readiness status will look stale until reported"
else
  warn "OTTERDEPLOY_CP_BACKUP_TOKEN not set — this run will not appear in \`otterdeploy backups control-plane status\`"
fi

if [ "$UPLOAD_OK" != "true" ]; then
  fail "backup produced but NOT uploaded off-host — it is not durable until it leaves this host"
fi

say ""
say "Control-plane backup complete: $REMOTE_KEY"
