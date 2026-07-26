#!/usr/bin/env bash
#
# otterdeploy control-plane restore — od-5j8.13
# ----------------------------------------------
# Reconstitutes a control plane on a FRESH host from an encrypted archive
# produced by scripts/control-plane-backup.sh. This is the "bare-metal
# disaster recovery" half of od-5j8.13: a new VPS + this script + the
# recovery key + a downloaded archive = a working control plane again.
#
# What it does, in order:
#   1. Decrypt the archive with the recovery key.
#   2. Restore Postgres data (pg_restore into a fresh `postgres` volume, via
#      a throwaway postgres container this script starts and tears down).
#   3. Restore Caddy state volumes (so certificates don't have to reissue).
#   4. Write back the ORIGINAL .env (which is how DATA_ENCRYPTION_KEYS /
#      BETTER_AUTH_SECRET come back — see the recovery-key module doc for
#      why decrypting the archive is the ENTIRE key-recovery ceremony, there
#      is no separate step).
#   5. `docker compose up -d` the restored stack.
#
# This script is DESTRUCTIVE to whatever otterdeploy state already exists at
# $OTTERDEPLOY_DATA_DIR on the host it runs on — it is meant for a genuinely
# fresh VPS. It refuses to run unless --yes is passed OR the data dir doesn't
# exist yet, mirroring uninstall.sh's confirmation discipline for the
# opposite (destructive) direction.
#
# Usage:
#   OTTERDEPLOY_RECOVERY_KEY=<64-hex-key> \
#     sudo -E bash control-plane-restore.sh --archive ./control-plane.tar.enc
#
# Tunables: same OTTERDEPLOY_DATA_DIR / OTTERDEPLOY_INSTALL_DIR as
# install.sh and control-plane-backup.sh.

set -Eeuo pipefail

DATA_DIR="${OTTERDEPLOY_DATA_DIR:-/data/otterdeploy}"
INSTALL_DIR="${OTTERDEPLOY_INSTALL_DIR:-$DATA_DIR/source}"
BUN_IMAGE="oven/bun:1.3.14-slim"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ARCHIVE=""
ASSUME_YES=false
prev=""
for a in "$@"; do
  case "$a" in
    --archive=*) ARCHIVE="${a#--archive=}" ;;
    -y|--yes) ASSUME_YES=true ;;
    -h|--help) sed -n '2,${/^[^#]/q;p;}' "$0"; exit 0 ;;
    *) [ "$prev" = "--archive" ] && ARCHIVE="$a" ;;
  esac
  prev="$a"
done

say()  { printf '%s\n' "$*"; }
step() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
warn() { printf '\033[33mwarning:\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

[ -n "$ARCHIVE" ] || fail "pass --archive <path-to-control-plane.tar.enc>"
[ -f "$ARCHIVE" ] || fail "no such file: $ARCHIVE"
[ -n "${OTTERDEPLOY_RECOVERY_KEY:-}" ] || fail "OTTERDEPLOY_RECOVERY_KEY is required"
command -v docker >/dev/null 2>&1 || fail "docker is required (install it first — see install.sh)"

if [ -d "$DATA_DIR" ] && [ "$ASSUME_YES" != "true" ]; then
  warn "$DATA_DIR already exists — this script overwrites it."
  printf 'Type "restore" to continue: '
  read -r confirm </dev/tty || fail "no terminal to confirm on — pass --yes"
  [ "$confirm" = "restore" ] || fail "not confirmed — nothing was touched"
fi

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/otterdeploy-cp-restore.XXXXXX")"
cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

step "1/5 · Decrypting the archive"
cp "$ARCHIVE" "$WORKDIR/control-plane.tar.enc"
docker run --rm \
  -v "$WORKDIR:/data" \
  -v "$SCRIPT_DIR/lib:/script:ro" \
  -e "OTTERDEPLOY_RECOVERY_KEY=$OTTERDEPLOY_RECOVERY_KEY" \
  "$BUN_IMAGE" bun /script/recovery-key.mjs decrypt --in /data/control-plane.tar.enc --out /data/control-plane.tar
tar -xf "$WORKDIR/control-plane.tar" -C "$WORKDIR"
[ -f "$WORKDIR/control-plane.pgdump" ] || fail "decrypted archive is missing control-plane.pgdump — wrong archive?"
[ -f "$WORKDIR/config/.env" ] || fail "decrypted archive is missing config/.env"
say "  decrypted + unpacked OK"

step "2/5 · Restoring config (.env recovers the encryption keyring)"
mkdir -p "$INSTALL_DIR"
cp "$WORKDIR/config/.env" "$INSTALL_DIR/.env"
[ -f "$WORKDIR/config/docker-compose.yml" ] && cp "$WORKDIR/config/docker-compose.yml" "$INSTALL_DIR/docker-compose.yml"
say "  wrote $INSTALL_DIR/.env — DATA_ENCRYPTION_KEYS/BETTER_AUTH_SECRET recovered as part of this file"

step "3/5 · Restoring Caddy state volumes"
for volume in otterdeploy-caddy-data otterdeploy-caddy-state; do
  archive_file="$WORKDIR/${volume}.tar.gz"
  if [ -f "$archive_file" ]; then
    docker volume create "$volume" >/dev/null
    docker run --rm -v "$volume:/to" -v "$WORKDIR:/from:ro" alpine \
      sh -c "tar xzf /from/${volume}.tar.gz -C /to"
    say "  restored $volume"
  else
    warn "no $volume in the archive — Caddy will re-issue certificates on first boot"
  fi
done

step "4/5 · Restoring Postgres"
# shellcheck source=/dev/null
set -a; source "$INSTALL_DIR/.env"; set +a
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-postgres}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:?missing POSTGRES_PASSWORD in restored .env}"
docker volume create otterdeploy-postgres-data >/dev/null
docker run -d --name otterdeploy-restore-postgres \
  -e POSTGRES_USER="$POSTGRES_USER" -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" -e POSTGRES_DB="$POSTGRES_DB" \
  -v otterdeploy-postgres-data:/var/lib/postgresql/data \
  postgres:17-alpine >/dev/null
trap 'docker rm -f otterdeploy-restore-postgres >/dev/null 2>&1 || true; cleanup' EXIT
say "  waiting for postgres to accept connections…"
for _ in $(seq 1 30); do
  docker exec otterdeploy-restore-postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1 && break
  sleep 1
done
docker cp "$WORKDIR/control-plane.pgdump" otterdeploy-restore-postgres:/tmp/control-plane.pgdump
docker exec otterdeploy-restore-postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists /tmp/control-plane.pgdump
docker rm -f otterdeploy-restore-postgres >/dev/null
say "  restored into volume otterdeploy-postgres-data"

step "5/5 · Bringing the stack up"
if [ -f "$INSTALL_DIR/docker-compose.yml" ]; then
  (cd "$INSTALL_DIR" && docker compose --env-file .env up -d postgres redis)
  say "  started postgres + redis — bring up the rest with:"
  say "    cd $INSTALL_DIR && docker compose --env-file .env --profile edge --profile build --profile firewall up -d"
else
  warn "no compose file was in the archive — fetch one (see install.sh's OTTERDEPLOY_COMPOSE_URL) and run \`docker compose up -d\` from $INSTALL_DIR"
fi

say ""
say "Control-plane restore complete."
say "Login, projects, routing/certs (if Caddy state restored), and deployment history should all be back."
say "Verify with: otterdeploy backups control-plane status"
