#!/usr/bin/env bash
#
# otterdeploy installer
# ---------------------
#   curl -fsSL https://get.otterdeploy.com/install.sh | bash
#
# Provisions a Linux host and brings up otterdeploy from published images.
# Pulls a prebuilt stack — no source checkout, no build toolchain. Sets up the
# optional ZFS pool for copy-on-write database branching; if ZFS isn't available
# the platform falls back to the logical (pg_dump) branching tier, so the
# installer never blocks on it.
#
# Tunables (env vars):
#   OTTERDEPLOY_DATA_DIR      host data folder        (default /data/otterdeploy)
#   OTTERDEPLOY_INSTALL_DIR   install root            (default $OTTERDEPLOY_DATA_DIR/source)
#   OTTERDEPLOY_VERSION       image tag to pull       (default latest)
#   OTTERDEPLOY_COMPOSE_URL   compose source: http(s) URL, local path, or file://
#                             (default get.otterdeploy.com/docker-compose.yml)
#   OTTERDEPLOY_NETWORK       shared stack network    (default otterdeploy)
#   OTTERDEPLOY_CONTROL_PLANE_PORT  dashboard port    (default 3000)
#   OTTERDEPLOY_ADVERTISE_ADDR  swarm advertise-addr  (default: primary source IP)
#   OTTERDEPLOY_BRANCHING     auto | on | off         (default auto) — ZFS branching pool
#
# Subcommand:  install.sh update   → just pull the new image tag and restart
#              (skips host setup; preserves all secrets).
#   OTTERDEPLOY_ZFS_POOL      pool name               (default otter)
#   OTTERDEPLOY_ZFS_SIZE      file-backed pool size   (default 40G)
#   OTTERDEPLOY_FIREWALL      true | false            (default false) — start CrowdSec profile
#   OTTERDEPLOY_DRY_RUN       true | false            (default false) — preview, change nothing
#   DOCKER_ADDRESS_POOL_BASE  overlay address pool    (default 10.0.0.0/8)
#   DOCKER_ADDRESS_POOL_SIZE  overlay subnet size     (default 24)

set -Eeuo pipefail   # -E so the ERR trap is inherited into functions

# ── config ──────────────────────────────────────────────────────────────────
DATA_DIR="${OTTERDEPLOY_DATA_DIR:-/data/otterdeploy}"
# The install root (compose + .env) lives UNDER the data folder as `source/`, so
# ALL platform state — config and generated artifacts — sits in one 0700 tree
# (mirrors Coolify's /data/coolify/source). Override with OTTERDEPLOY_INSTALL_DIR
# to split them back out. An earlier /opt/otterdeploy install is migrated in place
# (see migrate_legacy_install).
INSTALL_DIR="${OTTERDEPLOY_INSTALL_DIR:-$DATA_DIR/source}"
LEGACY_INSTALL_DIR="/opt/otterdeploy"
VERSION="${OTTERDEPLOY_VERSION:-latest}"
COMPOSE_URL="${OTTERDEPLOY_COMPOSE_URL:-https://get.otterdeploy.com/docker-compose.yml}"
COMPOSE_FILE="$INSTALL_DIR/docker-compose.yml"
ENV_FILE="$INSTALL_DIR/.env"
EDGE_NETWORK="${OTTERDEPLOY_NETWORK:-otterdeploy}"
CONTROL_PLANE_PORT="${OTTERDEPLOY_CONTROL_PLANE_PORT:-3000}"   # dashboard / control plane
ADVERTISE_ADDR="${OTTERDEPLOY_ADVERTISE_ADDR:-}"               # swarm advertise-addr override

BRANCHING="${OTTERDEPLOY_BRANCHING:-auto}"     # auto | on | off
ZFS_POOL="${OTTERDEPLOY_ZFS_POOL:-otter}"
ZFS_SIZE="${OTTERDEPLOY_ZFS_SIZE:-40G}"
ZFS_IMG="$DATA_DIR/branch-pool.img"
FIREWALL="${OTTERDEPLOY_FIREWALL:-false}"
DRY_RUN="${OTTERDEPLOY_DRY_RUN:-false}"
ASSUME_YES="${OTTERDEPLOY_YES:-false}"   # -y/--yes: skip the interactive prompts

DOCKER_ADDRESS_POOL_BASE="${DOCKER_ADDRESS_POOL_BASE:-10.0.0.0/8}"
DOCKER_ADDRESS_POOL_SIZE="${DOCKER_ADDRESS_POOL_SIZE:-24}"

REQUIRED_PORTS="80 443 $CONTROL_PLANE_PORT"   # Caddy edge (80/443) + control-plane UI (3000)
DATE="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="$INSTALL_DIR/install-$DATE.log"
IS_UPDATE=false
STEP=0

# ── helpers ─────────────────────────────────────────────────────────────────
say()  { printf '%s\n' "$*"; }
step() { STEP=$((STEP + 1)); printf '\n\033[1m[%s] %s\033[0m\n' "$STEP" "$*"; }
warn() { printf '\033[33mwarning:\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# Run a mutating command — or just print it in --dry-run.
run() {
  if [ "$DRY_RUN" = "true" ]; then printf '   \033[2m+ %s\033[0m\n' "$*"; return 0; fi
  "$@"
}
# True in --dry-run; callers use it to skip mutations that can't go through
# run() (pipes, redirects, heredocs) and print their own "would …" line.
dry() { [ "$DRY_RUN" = "true" ]; }

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  command -v sudo >/dev/null 2>&1 || fail "Run as root, or install sudo."
  SUDO="sudo"
fi

random_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

# Read an existing key from .env so re-runs preserve generated values.
env_value() {
  [ -f "$ENV_FILE" ] || return 0
  grep "^$1=" "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- | sed "s/^[\"']//;s/[\"']\$//" || true
}

# Keep an existing value if present, else use the generated one.
keep_or() { local existing; existing="$(env_value "$1")"; [ -n "$existing" ] && printf '%s' "$existing" || printf '%s' "$2"; }

detect_public_host() {
  local ip=""
  ip="$(curl -fsSL --max-time 4 https://api.ipify.org 2>/dev/null || true)"
  [ -z "$ip" ] && ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  [ -z "$ip" ] && ip="localhost"
  printf '%s' "$ip"
}

restart_docker() {
  if command -v systemctl >/dev/null 2>&1; then run $SUDO systemctl restart docker
  elif command -v service >/dev/null 2>&1; then run $SUDO service docker restart
  else warn "No service manager found — restart Docker manually for daemon changes to apply."; fi
}

# The host's primary outbound source IP — more reliable on multi-NIC/cloud hosts
# than `hostname -I`'s first token (which can be a docker/bridge address).
primary_ip() { ip route get 1 2>/dev/null | sed -n 's/^.*src \([0-9.]*\).*$/\1/p' | head -n1 || true; }

# Advisory recovery hint on any uncaught failure (set -e). No auto-undo.
on_error() {
  trap - ERR; set +e   # never let the handler re-trigger itself
  local code="$1"
  printf '\n\033[31mInstall failed at step %s (exit %s).\033[0m\n' "${STEP:-?}" "$code" >&2
  [ "$DRY_RUN" != "true" ] && [ -f "$LOG_FILE" ] && say "  Full log:           $LOG_FILE" >&2
  [ -f "/etc/docker/daemon.json.bak-$DATE" ] && say "  daemon.json backup: /etc/docker/daemon.json.bak-$DATE" >&2
  say "  Re-run is safe — secrets are preserved." >&2
  exit "$code"
}

# ── OS detection ──────────────────────────────────────────────────────────────
# Map the host distro onto one of the three package-manager families we support
# — debian (apt), rhel (dnf/yum), arch (pacman) — normalizing common derivatives
# onto their base. Anything else stops here, rather than failing mid-install.
OS_FAMILY=""
OS_PRETTY=""
detect_os() {
  [ -r /etc/os-release ] || fail "Cannot read /etc/os-release — unsupported host."
  # Source in a SUBSHELL and pull back only the fields we need: /etc/os-release
  # defines VERSION= (e.g. "26.04 LTS (…)"), which would otherwise clobber this
  # installer's own VERSION (the image tag) and poison OTTERDEPLOY_VERSION.
  # shellcheck disable=SC1091
  local pretty id like
  eval "$(. /etc/os-release; printf 'pretty=%q\nid=%q\nlike=%q\n' \
    "${PRETTY_NAME:-${ID:-unknown}}" "${ID:-}" "${ID_LIKE:-}")"
  OS_PRETTY="$pretty"
  case "$id" in
    ubuntu|debian|raspbian|linuxmint|pop|zorin|elementary|neon|devuan|kali) OS_FAMILY=debian ;;
    rhel|centos|fedora|rocky|almalinux|amzn|ol|tencentos|fedora-asahi-remix) OS_FAMILY=rhel ;;
    arch|archarm|manjaro|manjaro-arm|endeavouros|cachyos|garuda)            OS_FAMILY=arch ;;
    *)
      # Fall back to ID_LIKE for less common derivatives.
      case " $like " in
        *" debian "*|*" ubuntu "*)           OS_FAMILY=debian ;;
        *" rhel "*|*" fedora "*|*" centos "*) OS_FAMILY=rhel ;;
        *" arch "*)                           OS_FAMILY=arch ;;
      esac
      ;;
  esac
  [ -n "$OS_FAMILY" ] || fail "Unsupported distro '$OS_PRETTY'. Supported: Debian/Ubuntu, RHEL family (Fedora/Rocky/Alma/CentOS/Amazon), Arch."
  say " - OS: $OS_PRETTY ($OS_FAMILY family)"
}

# All base tools already present? Lets re-runs skip the package step entirely.
have_base_pkgs() {
  local p
  for p in curl git jq openssl; do command -v "$p" >/dev/null 2>&1 || return 1; done
  return 0
}

# ── 1. preflight ────────────────────────────────────────────────────────────
preflight() {
  step "Preflight checks"

  [ "$(uname -s)" = "Linux" ] || fail "The installer supports Linux hosts only (you're on $(uname -s))."
  [ -f /.dockerenv ] && fail "Refusing to install inside a Docker container."

  detect_os

  # Disk space — dumps and branch clones live under DATA_DIR.
  local avail_kb; avail_kb="$(df -Pk / | awk 'NR==2{print $4}')"
  if [ "${avail_kb:-0}" -lt 20000000 ]; then
    warn "Less than ~20G free on / — backups and branch clones may run out of room."
  fi

  for p in $REQUIRED_PORTS; do
    if command -v ss >/dev/null 2>&1 && ss -ltn "( sport = :$p )" 2>/dev/null | grep -q LISTEN; then
      fail "Port $p is already in use. Free it (or stop the conflicting service) and re-run."
    fi
  done
  say " - Ports $REQUIRED_PORTS are free"
}

# ── 2. base packages + docker ───────────────────────────────────────────────
install_prereqs() {
  step "Installing base packages"
  if have_base_pkgs; then
    say " - Base packages already present (curl, git, jq, openssl)"
  else
    case "$OS_FAMILY" in
      debian)
        run $SUDO apt-get update -y
        run $SUDO apt-get install -y ca-certificates curl git jq openssl
        ;;
      rhel)
        # Some minimal images ship without dnf — bootstrap it from yum.
        if ! command -v dnf >/dev/null 2>&1 && command -v yum >/dev/null 2>&1; then
          run $SUDO yum install -y dnf || true
        fi
        # Install curl only if missing: Fedora/RHEL ship curl-minimal and a plain
        # `dnf install curl` errors on the package conflict.
        command -v curl >/dev/null 2>&1 || run $SUDO dnf install -y curl
        run $SUDO dnf install -y ca-certificates git jq openssl
        ;;
      arch)
        run $SUDO pacman -Sy --noconfirm --needed ca-certificates curl git jq openssl
        ;;
    esac
  fi

  step "Installing Docker"
  # Reject snap-docker UNCONDITIONALLY — its confined socket/paths break us
  # whether or not docker is already on PATH.
  if $SUDO sh -c 'command -v snap >/dev/null 2>&1 && snap list docker >/dev/null 2>&1'; then
    fail "Docker installed via snap is unsupported. Remove it (snap remove docker) and re-run."
  fi
  if command -v docker >/dev/null 2>&1; then
    local dshow; dshow="$(docker --version 2>/dev/null | awk '{print $3}' | tr -d , || true)"
    say " - Docker already present ($dshow)"
  else
    case "$OS_FAMILY" in
      debian|rhel)
        # get.docker.com handles both the apt and dnf families.
        if dry; then say "   + curl -fsSL https://get.docker.com | sh"; else curl -fsSL https://get.docker.com | $SUDO sh; fi
        ;;
      arch)
        # get.docker.com refuses Arch — install from the official repos instead.
        run $SUDO pacman -Sy --noconfirm --needed docker docker-compose
        ;;
    esac
    dry || command -v docker >/dev/null 2>&1 || fail "Docker installation failed — install it manually: https://docs.docker.com/engine/install/"
  fi
  command -v systemctl >/dev/null 2>&1 && run $SUDO systemctl enable --now docker >/dev/null 2>&1 || true

  # Require Docker >= 28. Compose v2, address pools and BuildKit only need 24,
  # but 28 is the firewall/overlay-networking regime we test against — older
  # engines route published ports differently and aren't supported.
  if ! dry; then
    local dver dmajor
    dver="$($SUDO docker version --format '{{.Server.Version}}' 2>/dev/null || true)"
    dmajor="${dver%%.*}"
    if [ -n "$dmajor" ] && [ "$dmajor" -eq "$dmajor" ] 2>/dev/null; then
      [ "$dmajor" -lt 28 ] && fail "Docker $dver is too old — need >= 28. Upgrade: https://docs.docker.com/engine/install/"
      say " - Docker engine $dver (>= 28)"
    else
      warn "Could not determine Docker server version — ensure it is >= 28."
    fi
  fi

  if ! $SUDO docker compose version >/dev/null 2>&1; then
    say " - Installing docker compose plugin"
    case "$OS_FAMILY" in
      debian) run $SUDO apt-get install -y docker-compose-plugin || true ;;
      rhel)   run $SUDO dnf install -y docker-compose-plugin || true ;;
      arch)   run $SUDO pacman -S --noconfirm --needed docker-compose || true ;;
    esac
    dry || $SUDO docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 unavailable — install the docker compose plugin and re-run."
  fi
}

# ── 3. docker daemon overlay address pool ───────────────────────────────────
# Per-project overlay/bridge networks multiply fast; a roomy pool avoids
# exhausting the default address space once you run many projects.
configure_docker_pool() {
  step "Configuring Docker address pool"
  # Validate before writing — a malformed pool bricks the daemon on the restart
  # we trigger right after.
  echo "$DOCKER_ADDRESS_POOL_BASE" | grep -qE '^[0-9]+(\.[0-9]+){3}/[0-9]+$' \
    || fail "DOCKER_ADDRESS_POOL_BASE '$DOCKER_ADDRESS_POOL_BASE' is not a valid CIDR."
  case "$DOCKER_ADDRESS_POOL_SIZE" in
    ''|*[!0-9]*) fail "DOCKER_ADDRESS_POOL_SIZE must be an integer.";;
  esac
  { [ "$DOCKER_ADDRESS_POOL_SIZE" -ge 16 ] && [ "$DOCKER_ADDRESS_POOL_SIZE" -le 28 ]; } \
    || fail "DOCKER_ADDRESS_POOL_SIZE must be between 16 and 28 (got $DOCKER_ADDRESS_POOL_SIZE)."

  local daemon=/etc/docker/daemon.json tmp; tmp="$(mktemp)"
  local desired
  # Address pool (roomy space for per-project networks) + log rotation so
  # container JSON logs can't grow unbounded and fill the disk. Built without jq
  # so a fresh-host dry-run works before packages are installed.
  desired="$(cat <<JSON
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" },
  "default-address-pools": [ { "base": "$DOCKER_ADDRESS_POOL_BASE", "size": $DOCKER_ADDRESS_POOL_SIZE } ]
}
JSON
)"

  if [ -f "$daemon" ]; then
    # daemon.json is root-owned (mode 0600); read it through $SUDO so a re-run as
    # a non-root user can still inspect/merge it (else the pool check silently
    # fails and the merge below dies on an unreadable file).
    if $SUDO jq -e '."default-address-pools"' "$daemon" >/dev/null 2>&1; then
      say " - Address pool already configured; leaving daemon.json untouched"; rm -f "$tmp"; return
    fi
    run $SUDO cp "$daemon" "$daemon.bak-$DATE"
    $SUDO jq -s '.[0] * .[1]' "$daemon" <(printf '%s' "$desired") > "$tmp"
  else
    printf '%s' "$desired" > "$tmp"
  fi
  run $SUDO mkdir -p /etc/docker
  if dry; then say "   + write $daemon:"; sed 's/^/       /' "$tmp"; else $SUDO cp "$tmp" "$daemon"; fi
  rm -f "$tmp"
  restart_docker
  say " - Address pool set to $DOCKER_ADDRESS_POOL_BASE (size $DOCKER_ADDRESS_POOL_SIZE)"
}

# ── 4. swarm ────────────────────────────────────────────────────────────────
# The platform self-inits Swarm on boot, but doing it here lets overlay
# networking and the address pool settle before first start. Harmless under the
# default (plain-docker) runtime.
ensure_swarm() {
  step "Ensuring Docker Swarm is initialized"
  if dry; then say "   + would run docker swarm init --advertise-addr <primary-ip> if not already active"; return; fi
  if $SUDO docker info 2>/dev/null | grep -q 'Swarm: active'; then
    say " - Swarm already active"; return
  fi
  # Prefer the primary outbound source IP (correct on multi-NIC/cloud hosts);
  # fall back to hostname -I, then a public-IP lookup. Override with ADVERTISE_ADDR.
  local addr; addr="$ADVERTISE_ADDR"
  [ -z "$addr" ] && addr="$(primary_ip)"
  [ -z "$addr" ] && addr="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  [ -z "$addr" ] && addr="$(detect_public_host)"
  $SUDO docker swarm init --advertise-addr "$addr" >/dev/null 2>&1 \
    && say " - Swarm initialized (advertise-addr $addr)" \
    || warn "Swarm init skipped/failed — the platform will retry on startup."
}

# ── 4b. shared stack network ────────────────────────────────────────────────
# The stack (and the prod compose, which references it as `external`) attach to
# one stable, named network. Create it idempotently so `docker compose up`
# never fails on a missing external network. Per-project resource networks are
# still created dynamically by the platform on top of this.
ensure_network() {
  step "Ensuring the '$EDGE_NETWORK' network exists"
  if dry; then say "   + would ensure docker network '$EDGE_NETWORK' exists (create if absent)"; return; fi
  if $SUDO docker network inspect "$EDGE_NETWORK" >/dev/null 2>&1; then
    say " - Network '$EDGE_NETWORK' already exists"; return
  fi
  $SUDO docker network create "$EDGE_NETWORK" >/dev/null \
    && say " - Created network '$EDGE_NETWORK'" \
    || warn "Could not create network '$EDGE_NETWORK' — the stack may fail to start."
}

# ── 5. data dir + compose file ──────────────────────────────────────────────
# Run published images — fetch the production compose (image tags pinned via
# ${OTTERDEPLOY_VERSION}). Re-runs re-fetch so you pick up compose fixes.
prepare_tree() {
  step "Preparing $INSTALL_DIR and $DATA_DIR"
  # DATA_DIR is secret-bearing (dumps, keys, branch pool) → 0700.
  run $SUDO mkdir -p "$INSTALL_DIR" "$DATA_DIR"
  run $SUDO chmod 700 "$DATA_DIR"
  [ -n "$SUDO" ] && run $SUDO chown -R "$(id -u):$(id -g)" "$INSTALL_DIR" || true

  say " - Fetching $COMPOSE_URL"
  if dry; then
    say "   + fetch $COMPOSE_URL → validate → mv $COMPOSE_FILE"
    return
  fi
  # Download to a temp file, prove it's non-empty and a valid compose file, then
  # atomically move into place — so a truncated/HTML-error fetch is caught here,
  # before swarm/network/env mutations matter, not at `up`.
  # Download into a temp DIR as docker-compose.yml (not a bare temp file): the
  # compose declares `env_file: .env`, resolved relative to its own directory,
  # so validation needs a .env beside it. The real one is written in the next
  # step; seed an empty placeholder here purely so `config` can resolve the ref
  # (actual values are supplied via --env-file at pull/up time).
  local tmpd; tmpd="$(mktemp -d)"
  local tmp="$tmpd/docker-compose.yml"
  # Source is OTTERDEPLOY_COMPOSE_URL — point it at your own host, a raw GitHub
  # URL, or a local file/`file://` path. A local path is copied; anything else is
  # fetched over http(s).
  case "$COMPOSE_URL" in
    file://*)
      cp "${COMPOSE_URL#file://}" "$tmp" 2>/dev/null \
        || { rm -rf "$tmpd"; fail "No compose file at ${COMPOSE_URL#file://} (OTTERDEPLOY_COMPOSE_URL)."; } ;;
    /*|./*|../*|~*)
      cp "$COMPOSE_URL" "$tmp" 2>/dev/null \
        || { rm -rf "$tmpd"; fail "No compose file at $COMPOSE_URL (OTTERDEPLOY_COMPOSE_URL)."; } ;;
    *)
      curl -fsSL "$COMPOSE_URL" -o "$tmp" || { rm -rf "$tmpd"; fail "Could not fetch the compose file from $COMPOSE_URL.
       Set OTTERDEPLOY_COMPOSE_URL to a reachable source and re-run — e.g. a raw
       GitHub URL, your own host, or a local path/file:// URL:
         sudo OTTERDEPLOY_COMPOSE_URL=/path/to/docker-compose.yml bash $0"; } ;;
  esac
  [ -s "$tmp" ] || { rm -rf "$tmpd"; fail "Downloaded compose file is empty (bad URL or proxy?)."; }
  : > "$tmpd/.env"
  $SUDO docker compose -f "$tmp" --env-file /dev/null config -q >/dev/null 2>&1 \
    || { rm -rf "$tmpd"; fail "Downloaded compose file is not valid — refusing to continue."; }
  mv "$tmp" "$COMPOSE_FILE"
  rm -rf "$tmpd"
  say " - Compose file validated"
}

# ── 6. environment file ─────────────────────────────────────────────────────
write_env() {
  step "Writing $ENV_FILE"
  local pg_pass auth_secret pg_user pg_db pool_line public_host public_url cors_origin
  pg_user="$(keep_or POSTGRES_USER otterdeploy)"
  pg_db="$(keep_or POSTGRES_DB otterdeploy)"
  pg_pass="$(keep_or POSTGRES_PASSWORD "$(random_secret)")"
  auth_secret="$(keep_or BETTER_AUTH_SECRET "$(random_secret)")"
  public_host="$(keep_or PUBLIC_HOST "$(detect_public_host)")"
  # Auth authority + CORS origin. The server serves the dashboard on the same
  # origin (the control-plane port), so both default to that URL. keep_or
  # preserves an operator override across re-runs.
  public_url="$(keep_or BETTER_AUTH_URL "http://$public_host:$CONTROL_PLANE_PORT")"
  cors_origin="$(keep_or CORS_ORIGIN "$public_url")"
  pool_line="$(env_value BRANCH_ZFS_POOL)"   # set later by provision_branching

  if dry; then
    say "   + write $ENV_FILE (secrets redacted):"
    say "       POSTGRES_USER=$pg_user  POSTGRES_DB=$pg_db  POSTGRES_PASSWORD=********"
    say "       DATABASE_URL=postgres://$pg_user:********@postgres:5432/$pg_db"
    say "       REDIS_URL=redis://redis:6379  BETTER_AUTH_SECRET=********"
    say "       OTTERDEPLOY_DATA_DIR=$DATA_DIR  OTTERDEPLOY_INSTALL_DIR=$INSTALL_DIR"
    say "       PUBLIC_HOST=$public_host  CONTROL_PLANE_PORT=$CONTROL_PLANE_PORT"
    say "       BETTER_AUTH_URL=$public_url  CORS_ORIGIN=$cors_origin  NODE_ENV=production"
    return
  fi

  umask 077
  cat > "$ENV_FILE" <<EOF
# Generated by scripts/install.sh on $DATE. Secrets are preserved on re-run.
OTTERDEPLOY_VERSION=$VERSION
OTTERDEPLOY_DATA_DIR=$DATA_DIR
# Where this stack (compose + .env) lives on the host. The in-app updater
# bind-mounts this path to pull + recreate, so it must be the real location.
OTTERDEPLOY_INSTALL_DIR=$INSTALL_DIR
DEPLOY_RUNTIME=docker
CONTROL_PLANE_PORT=$CONTROL_PLANE_PORT
PUBLIC_HOST=$public_host

POSTGRES_USER=$pg_user
POSTGRES_PASSWORD=$pg_pass
POSTGRES_DB=$pg_db
DATABASE_URL=postgres://$pg_user:$pg_pass@postgres:5432/$pg_db
REDIS_URL=redis://redis:6379

BETTER_AUTH_SECRET=$auth_secret
# Auth authority + CORS origin — the server serves the dashboard on the same
# origin, so both point at the control-plane URL. Override (and re-run) if you
# reach the dashboard at a different host/domain, or better-auth cookies won't
# stick.
BETTER_AUTH_URL=$public_url
CORS_ORIGIN=$cors_origin

# Production install (server-ip auto-detect + real-domain behaviour).
NODE_ENV=production

# Database branching (docs/designs/db-branching.md). Empty = logical tier only.
BRANCH_ZFS_POOL=$pool_line
EOF
  say " - Secrets generated (and preserved across re-runs)"
}

# ── 7. ZFS branching pool ───────────────────────────────────────────────────
# Copy-on-write preview/branch databases need a ZFS pool. We provision one with
# no hardware requirement via a file-backed vdev, so instant branching is on by
# default. If ZFS can't be set up we don't fail — the platform uses the logical
# (pg_dump) branching tier instead.
provision_branching() {
  step "Setting up copy-on-write database branching (ZFS)"

  if [ "$BRANCHING" = "off" ]; then
    say " - Skipped (OTTERDEPLOY_BRANCHING=off); logical branching tier still works"
    return
  fi

  if ! command -v zpool >/dev/null 2>&1; then
    if command -v apt-get >/dev/null 2>&1; then
      say " - Installing zfsutils-linux"
      run $SUDO apt-get install -y zfsutils-linux || true
    fi
  fi
  if dry; then
    say "   + would create file-backed ZFS pool '$ZFS_POOL' ($ZFS_SIZE) at $ZFS_IMG (if absent)"
    say "   + would create+tune dataset '$ZFS_POOL/pg' (recordsize=16k atime=off)"
    say "   + would set BRANCH_ZFS_POOL=$ZFS_POOL in $ENV_FILE"
    say "   (no ZFS on host → platform would use the logical pg_dump tier instead)"
    return
  fi
  if ! command -v zpool >/dev/null 2>&1; then
    warn "ZFS unavailable on this host → falling back to logical branching (full pg_dump copies)."
    return
  fi
  # Make sure the kernel module actually loads (managed/odd kernels can lack it).
  if ! $SUDO modprobe zfs 2>/dev/null && ! $SUDO zpool status >/dev/null 2>&1; then
    warn "ZFS kernel module won't load → falling back to logical branching."
    return
  fi

  if $SUDO zpool list -H -o name 2>/dev/null | grep -qx "$ZFS_POOL"; then
    say " - Reusing existing ZFS pool '$ZFS_POOL'"
  else
    say " - Creating file-backed ZFS pool '$ZFS_POOL' ($ZFS_SIZE) at $ZFS_IMG"
    say "   (point OTTERDEPLOY_ZFS_POOL at a real disk for production-grade speed)"
    $SUDO mkdir -p "$DATA_DIR"
    if [ ! -f "$ZFS_IMG" ]; then
      $SUDO truncate -s "$ZFS_SIZE" "$ZFS_IMG"
    fi
    if ! $SUDO zpool create -f "$ZFS_POOL" "$ZFS_IMG"; then
      warn "zpool create failed → falling back to logical branching."
      return
    fi
  fi

  # Parent dataset for branchable DBs, tuned for Postgres (see design doc).
  $SUDO zfs create -p "$ZFS_POOL/pg" 2>/dev/null || true
  $SUDO zfs set recordsize=16k atime=off logbias=throughput "$ZFS_POOL/pg" 2>/dev/null || true

  # Record the pool so the control plane knows the ZFS tier is available.
  if grep -q '^BRANCH_ZFS_POOL=' "$ENV_FILE"; then
    sed -i "s|^BRANCH_ZFS_POOL=.*|BRANCH_ZFS_POOL=$ZFS_POOL|" "$ENV_FILE"
  else
    printf 'BRANCH_ZFS_POOL=%s\n' "$ZFS_POOL" >> "$ENV_FILE"
  fi
  say " - Instant CoW branching enabled (pool '$ZFS_POOL', dataset '$ZFS_POOL/pg')"
}

# ── 8. bring up the stack ───────────────────────────────────────────────────
# Populate the COMPOSE_F array with the -f flags to pass to docker compose: the
# base file, plus an operator-supplied override beside it if present. Compose
# stops auto-loading docker-compose.override.yml the moment ANY -f is given, so
# we add it explicitly — otherwise start/update would silently drop the override
# (e.g. a temporary image bridge) and recreate containers without it.
compose_f_args() {
  COMPOSE_F=(-f "$COMPOSE_FILE")
  local o
  for o in "$INSTALL_DIR/docker-compose.override.yml" "$INSTALL_DIR/docker-compose.override.yaml"; do
    [ -f "$o" ] && COMPOSE_F+=(-f "$o")
  done
  # The loop's last `[ -f … ]` test returns non-zero when the (usually absent)
  # override file isn't there, which would make this function exit 1 and trip
  # the `set -e` ERR trap at every call site (start_stack, wait_for_health).
  return 0
}

start_stack() {
  step "Starting otterdeploy"
  local profile_args=""
  [ "$FIREWALL" = "true" ] && profile_args="--profile firewall"
  compose_f_args
  # shellcheck disable=SC2086
  if dry; then
    say "   + $SUDO docker compose ${COMPOSE_F[*]} --env-file $ENV_FILE $profile_args pull"
    say "   + $SUDO docker compose ${COMPOSE_F[*]} --env-file $ENV_FILE $profile_args up -d"
    return
  fi
  # --progress plain: docker compose's fancy TUI writes to the terminal and
  # bypasses the log-file capture, so a `pull`/`up` failure left the log blank at
  # step 11. Plain progress goes to stderr → the log records the real error.
  $SUDO docker compose "${COMPOSE_F[@]}" --env-file "$ENV_FILE" $profile_args --progress plain pull
  $SUDO docker compose "${COMPOSE_F[@]}" --env-file "$ENV_FILE" $profile_args --progress plain up -d

  # Reclaim disk from images this pull superseded: pulling a new :latest leaves
  # the previous one dangling (untagged), and the server/builder images are
  # multi-GB, so a few `update`s otherwise fill the disk (Postgres then crash-
  # loops on ENOSPC). `image prune -f` only removes DANGLING images — never one a
  # container still references — so it's safe here. Best-effort; never fail the
  # run on cleanup.
  $SUDO docker image prune -f >/dev/null 2>&1 || true
}

# Don't declare success until the control plane actually answers — never show a
# green banner pointing at a dead port. On timeout, dump logs and fail.
wait_for_health() {
  step "Waiting for the control plane (port $CONTROL_PLANE_PORT)"
  dry && { say "   + would poll http://localhost:$CONTROL_PLANE_PORT until it responds"; return; }
  local i=0
  while [ "$i" -lt 45 ]; do
    if curl -fsS -o /dev/null --max-time 3 "http://localhost:$CONTROL_PLANE_PORT/" 2>/dev/null; then
      say " - Control plane is responding"; return 0
    fi
    i=$((i + 1)); sleep 2
  done
  warn "Control plane did not respond within ~90s. Recent logs:"
  compose_f_args
  $SUDO docker compose "${COMPOSE_F[@]}" --env-file "$ENV_FILE" logs --tail 200 >&2 2>/dev/null || true
  fail "otterdeploy did not become healthy — see logs above and $LOG_FILE."
}

# `install.sh update` — re-fetch the compose, pull the new image tag, restart.
# Skips host setup entirely and never touches secrets.
update_stack() {
  [ -f "$COMPOSE_FILE" ] || fail "No existing install at $COMPOSE_FILE — run the installer first."
  say "Updating otterdeploy (pull + restart) — secrets preserved…"
  prepare_tree
  start_stack
  wait_for_health
  say ""
  printf '\033[32motterdeploy updated.\033[0m\n'
  report_access
}

print_firewall_hint() {
  if command -v ufw >/dev/null 2>&1 && $SUDO ufw status 2>/dev/null | grep -qi 'Status: active'; then
    say ""
    say "UFW is active — allow the edge ports:"
    say "  sudo ufw allow 80/tcp && sudo ufw allow 443/tcp"
  fi
}

# Tell the user exactly where the app is reachable: public IPv4/IPv6, with the
# host's private/LAN addresses as a fallback.
report_access() {
  local v4 v6 default_ip private_ips
  v4="$(curl -4fsSL --max-time 5 https://api.ipify.org 2>/dev/null || true)"
  v6="$(curl -6fsSL --max-time 5 https://api6.ipify.org 2>/dev/null || true)"

  say ""
  printf '\033[32motterdeploy is up.\033[0m\n'
  say ""
  say "Access the dashboard at:"
  [ -n "$v4" ] && say "  Public IPv4:  http://$v4:$CONTROL_PLANE_PORT"
  [ -n "$v6" ] && say "  Public IPv6:  http://[$v6]:$CONTROL_PLANE_PORT"

  default_ip="$(ip route get 1 2>/dev/null | sed -n 's/^.*src \([0-9.]*\).*$/\1/p' || true)"
  private_ips="$(hostname -I 2>/dev/null || true)"
  if [ -n "$private_ips" ]; then
    say "  LAN fallback (if the public IP isn't reachable):"
    for ip in $private_ips; do
      [ "$ip" = "$v4" ] && continue
      say "    http://$ip:$CONTROL_PLANE_PORT"
    done
  fi
  [ -z "$v4$v6$private_ips" ] && say "  http://localhost:$CONTROL_PLANE_PORT"
  # Don't let the trailing `[ … ] && …` (false in the common case, where we DID
  # find an IP) make this function exit 1 and trip the `set -e` ERR trap after a
  # fully successful install.
  return 0
}

# ── legacy layout migration ───────────────────────────────────────────────────
# Earlier installs put the stack at /opt/otterdeploy; the install root now lives
# under the data folder ($DATA_DIR/source) so all platform state sits in one tree.
# Move an existing /opt/otterdeploy stack in place — once — so a plain re-run (or
# `update`) transparently adopts the new layout with secrets preserved. Runs
# before the update/install branches so both see the stack at its new path.
migrate_legacy_install() {
  # Skip when the operator pinned a custom install dir, when the legacy dir is
  # already the target, when there's nothing to migrate, or when the new location
  # is already populated (migration done, or a genuinely fresh install).
  [ -n "${OTTERDEPLOY_INSTALL_DIR:-}" ] && return 0
  [ "$INSTALL_DIR" = "$LEGACY_INSTALL_DIR" ] && return 0
  [ -f "$LEGACY_INSTALL_DIR/.env" ] || return 0
  [ -f "$ENV_FILE" ] && return 0

  step "Migrating install $LEGACY_INSTALL_DIR → $INSTALL_DIR"
  if dry; then
    say "   + would move every install file (compose, .env, any override, logs)"
    say "     into $INSTALL_DIR and remove $LEGACY_INSTALL_DIR"
    return 0
  fi
  run $SUDO mkdir -p "$INSTALL_DIR"
  # Move EVERYTHING the operator's install carries — the base compose, .env, any
  # docker-compose.override.yml or extra config, AND the installer logs — so the
  # whole install lives under the data folder and nothing lingers at the legacy
  # path. dotglob catches .env; nullglob avoids a literal '*' on an empty dir.
  local restore_glob; restore_glob="$(shopt -p dotglob nullglob)"
  shopt -s dotglob nullglob
  local f base
  for f in "$LEGACY_INSTALL_DIR"/*; do
    base="$(basename "$f")"
    run $SUDO mv "$f" "$INSTALL_DIR/$base"
  done
  eval "$restore_glob"
  [ -n "$SUDO" ] && run $SUDO chown -R "$(id -u):$(id -g)" "$INSTALL_DIR" || true
  # Drop the now-empty legacy dir so all platform state sits under the data tree.
  run $SUDO rmdir "$LEGACY_INSTALL_DIR" 2>/dev/null || true
  say " - Moved install files (compose, .env, override, logs) into $INSTALL_DIR; removed $LEGACY_INSTALL_DIR"
}

# ── interactive configuration ─────────────────────────────────────────────────
# Prompt for the main options when run on a terminal (`bash install.sh`). Reads
# from /dev/tty so it also works under `curl | bash` (where stdin is the piped
# script). Skipped with --yes, in --dry-run, or when there is no terminal
# (CI/cron) — those keep the old behaviour of env vars + defaults, so unattended
# installs are unchanged. An option already set via its OTTERDEPLOY_* env var is
# taken as-is with no prompt. Runs before the log capture so a changed DATA_DIR
# repoints the derived paths.
configure() {
  local tty=""; [ -r /dev/tty ] && tty=/dev/tty
  if [ "$ASSUME_YES" = "true" ] || dry || [ -z "$tty" ]; then
    return
  fi

  step "Configure otterdeploy  (Enter = keep the [default])"

  _ctx() { printf '   %s\n' "$*" > "$tty"; }        # explanatory context → terminal
  _ask() {                                          # _ask VAR OTTERDEPLOY_ENV "prompt" "default"
    local var="$1" envname="$2" q="$3" def="$4" ans
    [ -n "${!envname:-}" ] && return 0              # explicit env var wins, no prompt
    printf '   \033[1m%s\033[0m [%s]: ' "$q" "$def" > "$tty"
    IFS= read -r ans < "$tty" || ans=""
    printf -v "$var" '%s' "${ans:-$def}"
  }

  # 1) Database branching — first, because it decides a HOST-level capability
  #    (whether we set up a ZFS pool) rather than a simple app setting.
  _ctx ""
  _ctx "Database branching — spin up instant, throwaway COPIES of a database"
  _ctx "(for preview environments / tests) instead of a slow dump-and-restore."
  _ctx "  auto : use copy-on-write ZFS if this host supports it, else fall back"
  _ctx "         to the logical tier (works anywhere, but makes full pg_dump copies)."
  _ctx "  on   : require ZFS for instant branches; abort if it isn't available."
  _ctx "  off  : logical tier only — no ZFS pool is created on this host."
  _ctx "Leave it on 'auto' unless you have a reason not to."
  _ask BRANCHING OTTERDEPLOY_BRANCHING "Database branching (auto|on|off)" "$BRANCHING"

  # 2) Compose source
  _ctx ""
  _ctx "Compose source — where to fetch the stack definition (docker-compose.yml)."
  _ctx "Point it at your own URL, a local path, or a file:// path if the default"
  _ctx "host isn't reachable. Only change this if you self-host the compose file."
  _ask COMPOSE_URL OTTERDEPLOY_COMPOSE_URL "Compose source (URL / path / file://)" "$COMPOSE_URL"

  # 3) Firewall
  _ctx ""
  _ctx "Firewall (CrowdSec) — community IP-reputation blocking at the edge proxy."
  _ctx "Optional, and you can enable it later; it adds a container + a compose profile."
  if [ -z "${OTTERDEPLOY_FIREWALL:-}" ]; then
    local fw
    printf '   \033[1mEnable the bundled CrowdSec firewall?\033[0m [y/N]: ' > "$tty"
    IFS= read -r fw < "$tty" || fw=""
    case "$fw" in [Yy]*) FIREWALL=true ;; *) FIREWALL=false ;; esac
  fi

  printf '\n   Config → branching=%s  version=%s  firewall=%s\n           compose=%s\n' \
    "$BRANCHING" "$VERSION" "$FIREWALL" "$COMPOSE_URL" > "$tty"
}

usage() {
  cat <<EOF
otterdeploy installer

  curl -fsSL https://get.otterdeploy.com/install.sh | bash
  curl -fsSL https://get.otterdeploy.com/install.sh | bash -s -- --dry-run

Subcommands:
  (none)           Install / re-install.
  update           Pull the new image tag and restart; skips host setup.

Flags:
  -n, --dry-run    Preview every action; change nothing on the host.
  -y, --yes        Don't prompt; use env vars + defaults (unattended install).
      --firewall   Start the bundled CrowdSec (firewall) profile.
  -h, --help       Show this help.

Run \`bash install.sh\` on a terminal and it asks for the main options (compose
source, port, data dir, version, branching, firewall) before installing. Piped
\`curl | bash\`, --yes, --dry-run, or no TTY skip the prompts and use env vars +
defaults. Any OTTERDEPLOY_* env var that's set is used as-is (that prompt is
skipped). All flags have env-var equivalents (see header), e.g. OTTERDEPLOY_YES=true.
EOF
}

main() {
  local mode="install"
  for arg in "$@"; do
    case "$arg" in
      update)       mode="update" ;;
      -n|--dry-run) DRY_RUN=true ;;
      -y|--yes)     ASSUME_YES=true ;;
      --firewall)   FIREWALL=true ;;
      -h|--help)    usage; exit 0 ;;
      *) fail "Unknown argument: $arg (try --help)" ;;
    esac
  done

  # Ask for the main options on a fresh install when run interactively (no-op
  # under --yes / --dry-run / no TTY). Must run BEFORE the log capture so a
  # changed DATA_DIR repoints INSTALL_DIR / LOG_FILE.
  [ "$mode" = "install" ] && configure

  # Capture the whole run to a timestamped log (curl|bash has no scrollback).
  if [ "$DRY_RUN" != "true" ]; then
    mkdir -p "$INSTALL_DIR" 2>/dev/null || $SUDO mkdir -p "$INSTALL_DIR" || true
    [ -w "$INSTALL_DIR" ] && exec > >(tee -a "$LOG_FILE") 2>&1
  fi
  trap 'on_error $?' ERR
  [ -f "$ENV_FILE" ] && IS_UPDATE=true

  say "=========================================="
  say "  otterdeploy installer — $DATE"
  [ "$mode" = "update" ] && say "  MODE: update"
  [ "$DRY_RUN" = "true" ] && say "  DRY RUN — no changes will be made"
  say "=========================================="

  migrate_legacy_install

  if [ "$mode" = "update" ]; then
    update_stack
    return
  fi

  preflight
  install_prereqs
  configure_docker_pool
  ensure_swarm
  ensure_network
  prepare_tree
  write_env
  provision_branching
  start_stack
  wait_for_health

  if [ "$DRY_RUN" = "true" ]; then
    say ""
    say "Dry run complete — nothing was changed. Re-run without --dry-run to install."
    return
  fi

  report_access
  print_firewall_hint
  say ""
  say "Files:"
  say "  Compose: $COMPOSE_FILE"
  say "  Data:    $DATA_DIR"
  say "  Config:  $ENV_FILE"
  say "  Log:     $LOG_FILE"
  say ""
  say "Manage it:"
  say "  sudo docker compose -f $COMPOSE_FILE --env-file $ENV_FILE ps"
  say "  sudo docker compose -f $COMPOSE_FILE --env-file $ENV_FILE logs -f"
  say "  curl -fsSL https://get.otterdeploy.com/install.sh | sudo bash -s -- update   # pull a new version"
  if [ -n "$(env_value BRANCH_ZFS_POOL)" ]; then
    say ""
    say "Database branching: instant copy-on-write tier ENABLED (ZFS pool '$(env_value BRANCH_ZFS_POOL)')."
  else
    say ""
    say "Database branching: logical tier only (full-copy). Install ZFS + re-run to enable instant branches."
  fi
}

main "$@"
