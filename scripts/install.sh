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
#   OTTERDEPLOY_VERSION       image tag to pull       (default: newest GitHub
#                             Release tag, e.g. v0.4.2; falls back to `latest`
#                             when no release is reachable)
#   OTTERDEPLOY_UPDATE_REPO   GitHub repo for the release lookup (default otterdeploy/otterdeploy)
#   OTTERDEPLOY_COMPOSE_URL   compose source: http(s) URL, local path, or file://
#                             (default get.otterdeploy.com/docker-compose.yml)
#   OTTERDEPLOY_NETWORK       shared stack network    (default otterdeploy)
#   OTTERDEPLOY_CONTROL_PLANE_PORT  dashboard port    (default 3000)
#   OTTERDEPLOY_CONTROL_PLANE_BIND  dashboard bind address (default 0.0.0.0 — reachable
#                             at this host's addresses). Set 127.0.0.1 to publish the
#                             dashboard to loopback only and reach it through a domain
#                             or an SSH tunnel instead.
#   OTTERDEPLOY_SERVER_IP     address this host is reachable at (default: detected —
#                             public IP, else primary source IP). Written to .env as
#                             SERVER_IP; builds the <app>-<project>.<ip>.sslip.io
#                             fallback domains that give an exposed service a working
#                             URL before you own a domain.
#   OTTERDEPLOY_ADVERTISE_ADDR  swarm advertise-addr  (default: primary source IP)
#   OTTERDEPLOY_BRANCHING     auto | on | off         (default auto) — ZFS branching pool
#
# Subcommand:  install.sh update   → just pull the new image tag and restart
#              (skips host setup; preserves all secrets).
#   OTTERDEPLOY_ZFS_POOL      pool name               (default otter)
#   OTTERDEPLOY_ZFS_SIZE      file-backed pool size   (default: ¼ of free disk, 5G–40G)
#   OTTERDEPLOY_FIREWALL      true | false            (default true — od-5j8.11) — CrowdSec
#                             bundled + on by default: the bouncer key/LAPI wiring is
#                             generated automatically and the `firewall` compose profile is
#                             started, so a fresh install is protected with no manual steps.
#                             Set to false (or pass --no-firewall) to opt out explicitly.
#                             Independently, a host-level nftables baseline (default-deny
#                             INPUT + a DOCKER-USER guard) is applied unless another firewall
#                             manager (ufw/firewalld) is already active on the host, or nftables
#                             can't be installed — both are narrated, never silently skipped.
#   OTTERDEPLOY_SWAP          auto | on | off         (default auto) — add a swapfile so heavy
#                             builds don't OOM (auto: only when RAM is tight and no swap exists)
#   OTTERDEPLOY_SWAP_SIZE     swapfile size           (default: sized from RAM, e.g. 4G)
#   OTTERDEPLOY_SWAP_FILE     swapfile path           (default /swapfile)
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
# Empty ⇒ resolve the newest published release tag later (resolve_version), so
# installs boot from a PINNED vX.Y.Z. The in-app updater compares that pin to
# GitHub releases/latest — a semver current is what makes "update available"
# fire and `compose pull` target a tag that exists. Set OTTERDEPLOY_VERSION to
# pin explicitly (including `latest` to ride main).
VERSION="${OTTERDEPLOY_VERSION:-}"
RELEASE_REPO="${OTTERDEPLOY_UPDATE_REPO:-otterdeploy/otterdeploy}"
COMPOSE_URL="${OTTERDEPLOY_COMPOSE_URL:-https://get.otterdeploy.com/docker-compose.yml}"
COMPOSE_FILE="$INSTALL_DIR/docker-compose.yml"
ENV_FILE="$INSTALL_DIR/.env"
EDGE_NETWORK="${OTTERDEPLOY_NETWORK:-otterdeploy}"
CONTROL_PLANE_PORT="${OTTERDEPLOY_CONTROL_PLANE_PORT:-3000}"   # dashboard / control plane
ADVERTISE_ADDR="${OTTERDEPLOY_ADVERTISE_ADDR:-}"               # swarm advertise-addr override

BRANCHING="${OTTERDEPLOY_BRANCHING:-auto}"     # auto | on | off
ZFS_POOL="${OTTERDEPLOY_ZFS_POOL:-otter}"
ZFS_SIZE="${OTTERDEPLOY_ZFS_SIZE:-}"   # empty = size from free disk (see pool_size)
ZFS_IMG="$DATA_DIR/branch-pool.img"
# od-5j8.11: on by default — this is the product's headline differentiator
# (CrowdSec bundled + blocking hostile traffic at the edge on every node, not
# an opt-in an operator has to discover). Explicit opt-out: OTTERDEPLOY_FIREWALL=false
# or --no-firewall.
FIREWALL="${OTTERDEPLOY_FIREWALL:-true}"

SWAP="${OTTERDEPLOY_SWAP:-auto}"          # auto | on | off — swapfile for build OOM headroom
SWAP_SIZE="${OTTERDEPLOY_SWAP_SIZE:-}"    # empty ⇒ sized from RAM (see swap_size_default)
SWAP_FILE="${OTTERDEPLOY_SWAP_FILE:-/swapfile}"

DRY_RUN="${OTTERDEPLOY_DRY_RUN:-false}"
ASSUME_YES="${OTTERDEPLOY_YES:-false}"   # -y/--yes: skip the interactive prompts
VERBOSE="${OTTERDEPLOY_VERBOSE:-false}"  # -v/--verbose: mirror the full log to the terminal

DOCKER_ADDRESS_POOL_BASE="${DOCKER_ADDRESS_POOL_BASE:-10.0.0.0/8}"
DOCKER_ADDRESS_POOL_SIZE="${DOCKER_ADDRESS_POOL_SIZE:-24}"

REQUIRED_PORTS="80 443 $CONTROL_PLANE_PORT"   # Caddy edge (80/443) + control-plane UI (3000)
DATE="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="$INSTALL_DIR/install-$DATE.log"
IS_UPDATE=false
STEP=0
LAST_STEP=""   # name of the most recent step(), for the failure report
# Detected in install_prereqs (which runs during the Host phase, since it also
# installs the base packages) but reported on the Docker phase line.
DOCKER_VER=""

# ── output model ────────────────────────────────────────────────────────────
# Two audiences, two streams:
#
#   the LOG   — every step header, every detail line, every command. Always
#               complete; it is what you read when something went wrong.
#   the TERM  — one line per PHASE, then the notes worth acting on, then how
#               to reach the thing. Nothing an operator can't act on.
#
# In quiet mode (the default) main() points stdout/stderr at the log, so the
# existing say()/step()/run() calls throughout this script keep narrating into
# it unchanged, and only the phase/summary helpers below — which write to fd 3,
# the terminal saved aside before that redirect — reach the screen. --verbose
# tees the log to the terminal as well, which is the old behaviour.
exec 3>&1
TERM_IS_TTY=false
if [ -t 1 ]; then TERM_IS_TTY=true; fi
# True once main() has pointed stdout/stderr at the log. Until then fd 3 and
# stdout are the same terminal, so error paths must not write to both.
LOG_ACTIVE=false

say()  { printf '%s\n' "$*"; }
step() { STEP=$((STEP + 1)); LAST_STEP="$*"; printf '\n\033[1m[%s] %s\033[0m\n' "$STEP" "$*"; }
fail() {
  printf '\033[31merror:\033[0m %s\n' "$*" >&3
  if [ "$LOG_ACTIVE" = true ]; then printf 'error: %s\n' "$*" >&2; fi
  exit 1
}

# Terminal-only output — bypasses the log redirection.
tsay() { printf '%s\n' "$*" >&3; }

# How to re-invoke this installer in a form the operator can paste back. Under
# `curl … | bash` there is no script on disk — $0 is just "bash", so printing
# "bash $0 firewall-status" told them to run something that doesn't exist.
self_cmd() {
  if [ -f "$0" ] && [ -r "$0" ]; then printf 'sudo bash %s' "$0"
  else printf 'curl -fsSL https://get.otterdeploy.com/install.sh | sudo bash -s --'
  fi
}

# A warning the operator may need to ACT on. Shown at the end, in one block,
# in plain language — not mixed into the narration where it reads like the
# install is failing. Still logged inline for the post-mortem.
NOTES=()
warn() {
  printf '\033[33mwarning:\033[0m %s\n' "$*" >&2
  NOTES+=("$*")
}

# ── phases ──────────────────────────────────────────────────────────────────
# A phase groups several internal steps under one outcome the operator cares
# about. Chips are the short facts that make the line worth reading ("29.6.1",
# "swarm active") — the reasoning behind them stays in the log.
PHASE_LABEL=""; PHASE_CHIPS=""; PHASE_STATE=""

chip() {
  if [ -n "$PHASE_CHIPS" ]; then PHASE_CHIPS="$PHASE_CHIPS · $1"; else PHASE_CHIPS="$1"; fi
}

# Mark the current phase as not-done-as-intended. Still not a failure — the
# install continues; the reason lands in the notes block.
phase_skip() { PHASE_STATE=skip; }

# Close out the running phase, printing its one-line result. Silent under
# --verbose: the step-by-step narration is already on screen there, and a
# summary line interleaved into it is just noise.
phase_end() {
  if [ -z "$PHASE_LABEL" ]; then return 0; fi
  if [ "$VERBOSE" != "true" ]; then
    local mark='\033[32m✓\033[0m'
    if [ "$PHASE_STATE" = skip ]; then mark='\033[33m·\033[0m'; fi
    if [ "$TERM_IS_TTY" = true ]; then printf '\r\033[2K' >&3; fi
    printf "  $mark %-13s \033[2m%s\033[0m\n" "$PHASE_LABEL" "$PHASE_CHIPS" >&3
  fi
  PHASE_LABEL=""; PHASE_CHIPS=""; PHASE_STATE=""
  return 0
}

# Start a phase. On a TTY the in-progress label is shown immediately (and
# overwritten by phase_end) so a long docker pull doesn't look like a hang.
phase() {
  phase_end
  PHASE_LABEL="$1"; PHASE_CHIPS=""; PHASE_STATE=""
  if [ "$VERBOSE" != "true" ] && [ "$TERM_IS_TTY" = true ]; then
    printf '  \033[2m· %s…\033[0m' "$2" >&3
  fi
  printf '\n========== %s ==========\n' "$2"
  return 0
}

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

# od-gez: the address this host is actually reachable at. Written to .env as
# SERVER_IP, which is what packages/api/src/lib/server-ip.ts treats as the
# operator override (precedence #1) — so it is never overwritten by the app's
# own public-IP echo on a later boot. Without it the app falls back to that
# echo, which returns the router's WAN address on a NATed host and nothing at
# all with no egress; packages/api/src/lib/domains.ts then builds every
# generated service domain as `<app>-<project>.127.0.0.1.sslip.io` — a URL
# that looks live and resolves to loopback.
#
# Public first (that's what a VPS needs and what sslip.io must encode to be
# reachable off-box), local source address second (correct for LAN/NAT/VM
# installs, and the only answer with no outbound internet).
detect_server_ip() {
  local ip=""
  [ -n "${OTTERDEPLOY_SERVER_IP:-}" ] && { printf '%s' "$OTTERDEPLOY_SERVER_IP"; return; }
  ip="$(curl -fsSL --max-time 4 https://api.ipify.org 2>/dev/null || true)"
  [ -z "$ip" ] && ip="$(primary_ip)"
  [ -z "$ip" ] && ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  [ -z "$ip" ] && ip="127.0.0.1"
  printf '%s' "$ip"
}

# Every other address this host answers on, one per line, excluding the one
# detect_server_ip picked. Printed in the install summary so an operator whose
# public IP isn't reachable (NAT, firewalled provider, private VM) has the
# working URL in front of them instead of having to go find it — the same
# affordance coolify.sh:1038-1046 gives.
detect_private_ips() {
  local chosen="$1" ip
  { hostname -I 2>/dev/null || ip -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1; } \
    | tr ' ' '\n' | while read -r ip; do
      [ -n "$ip" ] || continue
      case "$ip" in *:*) continue ;; esac          # ipv4 only — the sslip form we generate
      [ "$ip" = "$chosen" ] && continue
      printf '%s\n' "$ip"
    done
}

# od-5j8.10: the control plane only honors X-Forwarded-For/X-Forwarded-Proto
# from an immediate peer in TRUSTED_PROXIES (packages/env/src/server.ts) —
# otherwise a tenant workload or a direct caller could spoof its IP/scheme
# past rate limits, IP allowlists, and audit-log attribution. The Caddy edge
# container reaches `server:3000` over the shared "$EDGE_NETWORK" network, so
# its actual subnet (assigned by Docker, not predictable ahead of time) has
# to be trusted alongside loopback. Called AFTER ensure_network, once the
# network exists to inspect; falls back to loopback-only (the app's own safe
# default) if inspection fails for any reason.
detect_trusted_proxies() {
  local subnets
  subnets="$($SUDO docker network inspect "$EDGE_NETWORK" \
    --format '{{range .IPAM.Config}}{{.Subnet}},{{end}}' 2>/dev/null | sed 's/,$//')"
  if [ -n "$subnets" ]; then
    printf '127.0.0.1/32,::1/128,%s' "$subnets"
  else
    printf '127.0.0.1/32,::1/128'
  fi
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
  local code="$1"
  # `set -E` propagates this trap into command substitutions and subshells, so a
  # failure inside `x="$(f)"` fires it once per nesting level — each one printing
  # "Install failed" for a run that is still going. Only the top-level shell may
  # report; a subshell just lets errexit unwind and the status propagate.
  [ "${BASHPID:-$$}" = "$$" ] || return 0
  trap - ERR; set +e   # never let the handler re-trigger itself
  # → fd 3: in quiet mode stderr is the log file, and a failure the operator
  #   can't see is the one thing this handler exists to prevent.
  if [ "$TERM_IS_TTY" = true ]; then printf '\r\033[2K' >&3; fi
  printf '\n\033[31m✗ %s failed.\033[0m\n' "${PHASE_LABEL:-Install}" >&3
  printf '  Last step: %s\n' "${LAST_STEP:-?} (exit $code)" >&3
  if [ "$DRY_RUN" != "true" ] && [ -f "$LOG_FILE" ]; then
    printf '  What happened is in the log — the last 20 lines are usually enough:\n' >&3
    printf '    tail -n 20 %s\n' "$LOG_FILE" >&3
  fi
  if [ -f "/etc/docker/daemon.json.bak-$DATE" ]; then
    printf '  daemon.json backup: /etc/docker/daemon.json.bak-%s\n' "$DATE" >&3
  fi
  printf '  Re-running is safe — secrets and data are preserved.\n' >&3
  # Mirror into the log too, so the log ends with the same verdict.
  if [ "$LOG_ACTIVE" = true ]; then
    printf '\nInstall failed during "%s" at step "%s" (exit %s).\n' \
      "${PHASE_LABEL:-?}" "${LAST_STEP:-?}" "$code" >&2
  fi
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
  chip "$OS_PRETTY"
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
    warn "Less than ~20G free on / — the install will complete, but backups and branch clones may run out of room later. Add disk when you can."
  fi

  # Memory — a frontend build (vite/webpack) inside BuildKit can spike 1–2G; on
  # a small host with no swap the kernel OOM-kills buildkitd mid-build. Flag it
  # here; provision_swap adds a swapfile so those spikes spill to disk instead.
  local mem_mb swap_kb
  mem_mb="$(awk '/^MemTotal:/{printf "%d",$2/1024}' /proc/meminfo 2>/dev/null || echo 0)"
  swap_kb="$(awk 'NR>1{s+=$3} END{print s+0}' /proc/swaps 2>/dev/null || echo 0)"
  if [ "${mem_mb:-0}" -lt 6000 ] && [ "${swap_kb:-0}" -eq 0 ]; then
    say " - Low RAM (${mem_mb} MiB) and no swap — a swapfile will be added so builds don't OOM"
  else
    say " - Memory: ${mem_mb} MiB RAM, $((swap_kb / 1024)) MiB swap"
  fi
  chip "$(awk -v m="${mem_mb:-0}" 'BEGIN{printf "%.1fG RAM", m/1024}')"

  for p in $REQUIRED_PORTS; do
    if command -v ss >/dev/null 2>&1 && ss -ltn "( sport = :$p )" 2>/dev/null | grep -q LISTEN; then
      fail "Port $p is already in use. Free it (or stop the conflicting service) and re-run."
    fi
  done
  say " - Ports $REQUIRED_PORTS are free"
  chip "ports free"
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
    DOCKER_VER="$dshow"
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
      DOCKER_VER="$dver"
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

# ── 2c. swap file (OOM headroom for builds) ─────────────────────────────────
# A frontend build (vite/webpack/next) inside BuildKit can spike 1–2G of RAM.
# On a small host with little or no swap the kernel's OOM killer takes down
# buildkitd mid-build — the build fails with "rpc error … EOF" and no obvious
# cause. A swapfile lets that spike spill to disk instead of killing the daemon.
# Best-effort, mirroring provision_branching: any failure warns and continues,
# never blocks the install.

mem_total_mb() { awk '/^MemTotal:/{printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 0; }

# Parse a size like "4G"/"512M" to MiB (no numfmt dependency).
size_to_mib() {
  local s="${1:-0}" n unit
  n="${s%[GgMmKk]}"; unit="${s: -1}"
  case "$unit" in G|g) echo $((n * 1024));; M|m) echo "$n";; K|k) echo $((n / 1024));; *) echo "$s";; esac
}

# Default swapfile size from RAM: enough for one heavy build. Empty ⇒ "ample
# RAM, auto mode skips".
swap_size_default() {
  local ram; ram="$(mem_total_mb)"
  if   [ "$ram" -lt 6000 ]; then echo "4G"
  elif [ "$ram" -lt 8000 ]; then echo "2G"
  else echo ""
  fi
}

provision_swap() {
  step "Configuring swap (build OOM headroom)"

  if [ "$SWAP" = "off" ]; then
    say " - Skipped (OTTERDEPLOY_SWAP=off)"
    return
  fi

  # Never stack a second swap area on top of existing swap.
  local active_kb; active_kb="$(awk 'NR>1{s+=$3} END{print s+0}' /proc/swaps 2>/dev/null || echo 0)"
  if [ "${active_kb:-0}" -gt 0 ]; then
    say " - Swap already active ($((active_kb / 1024)) MiB) — leaving it as-is"
    return
  fi

  local ram size; ram="$(mem_total_mb)"
  size="$SWAP_SIZE"; [ -z "$size" ] && size="$(swap_size_default)"

  # auto: only add swap when RAM is tight — a big host with no swap is fine.
  if [ "$SWAP" = "auto" ] && [ -z "$size" ]; then
    say " - Skipped: ${ram} MiB RAM is ample (set OTTERDEPLOY_SWAP=on to force a swapfile)"
    return
  fi
  [ -z "$size" ] && size="2G"   # 'on' on a big box → a modest default

  if [ -e "$SWAP_FILE" ]; then
    warn "$SWAP_FILE exists but isn't active — leaving it untouched (enable it manually or remove and re-run)."
    return
  fi

  # Ensure the target filesystem has room for the file + ~1G headroom.
  local size_mib free_kb; size_mib="$(size_to_mib "$size")"
  free_kb="$(df -Pk "$(dirname "$SWAP_FILE")" | awk 'NR==2{print $4}')"
  if [ "${free_kb:-0}" -lt "$(((size_mib + 1024) * 1024))" ]; then
    warn "Not enough free disk for a ${size} swapfile at $SWAP_FILE — skipping swap."
    return
  fi

  if dry; then
    say "   + would create a ${size} swapfile at $SWAP_FILE (fallocate → mkswap → swapon)"
    say "   + would persist it in /etc/fstab and set vm.swappiness=10"
    return
  fi

  say " - Creating ${size} swapfile at $SWAP_FILE (RAM: ${ram} MiB)"
  # fallocate is instant, but on some filesystems (btrfs) it yields a file
  # mkswap rejects — fall back to dd, which always produces a plain allocation.
  if ! $SUDO fallocate -l "$size" "$SWAP_FILE" 2>/dev/null; then
    $SUDO dd if=/dev/zero of="$SWAP_FILE" bs=1M count="$size_mib" status=none 2>/dev/null || {
      warn "Could not allocate the swapfile — skipping swap."; $SUDO rm -f "$SWAP_FILE"; return; }
  fi
  $SUDO chmod 600 "$SWAP_FILE"
  if ! $SUDO mkswap "$SWAP_FILE" >/dev/null 2>&1 || ! $SUDO swapon "$SWAP_FILE" 2>/dev/null; then
    warn "mkswap/swapon failed (some kernels or filesystems disallow swapfiles) — skipping swap."
    $SUDO swapoff "$SWAP_FILE" 2>/dev/null || true
    $SUDO rm -f "$SWAP_FILE"
    return
  fi

  # Persist across reboots (idempotent) and prefer RAM — only swap under real
  # pressure, which suits a build host (swappiness=10).
  grep -qs "^${SWAP_FILE}[[:space:]]" /etc/fstab \
    || printf '%s none swap sw 0 0\n' "$SWAP_FILE" | $SUDO tee -a /etc/fstab >/dev/null
  $SUDO sysctl -w vm.swappiness=10 >/dev/null 2>&1 || true
  if [ -d /etc/sysctl.d ] && ! grep -qs 'vm.swappiness' /etc/sysctl.d/99-otterdeploy.conf 2>/dev/null; then
    printf 'vm.swappiness=10\n' | $SUDO tee /etc/sysctl.d/99-otterdeploy.conf >/dev/null
  fi
  say " - Swap active: ${size} at $SWAP_FILE (swappiness=10, persisted in /etc/fstab)"
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
  # Read the field directly rather than `docker info | grep -q` — see
  # detect_swarm_peer_ips for why that pipeline lies under pipefail.
  if [ "$($SUDO docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null || true)" = "active" ]; then
    say " - Swarm already active"; chip "swarm active"; return
  fi
  # Prefer the primary outbound source IP (correct on multi-NIC/cloud hosts);
  # fall back to hostname -I, then a public-IP lookup. Override with ADVERTISE_ADDR.
  local addr; addr="$ADVERTISE_ADDR"
  [ -z "$addr" ] && addr="$(primary_ip)"
  [ -z "$addr" ] && addr="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  [ -z "$addr" ] && addr="$(detect_public_host)"
  $SUDO docker swarm init --advertise-addr "$addr" >/dev/null 2>&1 \
    && { say " - Swarm initialized (advertise-addr $addr)"; chip "swarm active"; } \
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
  local pg_pass auth_secret bootstrap_token pg_user pg_db pool_line server_ip control_plane_bind public_url cors_origin trusted_proxies
  local crowdsec_bouncer_key crowdsec_lapi_url crowdsec_firewall_bouncer_key crowdsec_env_lines
  pg_user="$(keep_or POSTGRES_USER otterdeploy)"
  pg_db="$(keep_or POSTGRES_DB otterdeploy)"
  pg_pass="$(keep_or POSTGRES_PASSWORD "$(random_secret)")"
  auth_secret="$(keep_or BETTER_AUTH_SECRET "$(random_secret)")"
  bootstrap_token="$(keep_or OTTERDEPLOY_BOOTSTRAP_TOKEN "$(random_secret)")"
  # od-gez: replaces PUBLIC_HOST, which was written here and read by NOTHING in
  # the repo — the installer detected the right value into a variable no code
  # consumed, while SERVER_IP (the one packages/env/src/server.ts declares and
  # server-ip.ts reads) was never written at all.
  server_ip="$(keep_or SERVER_IP "$(detect_server_ip)")"
  control_plane_bind="$(keep_or CONTROL_PLANE_BIND "${OTTERDEPLOY_CONTROL_PLANE_BIND:-0.0.0.0}")"

  # od-5j8.11: generate the CrowdSec wiring so the firewall is protected with
  # ZERO manual steps when FIREWALL=true (the default) — previously an
  # operator had to hand-set these two vars and start the profile themselves.
  # keep_or preserves them across re-runs so bouncer registrations don't
  # churn. Left EMPTY when firewall=false so the Caddy `crowdsec` gate stays
  # unconfigured (packages/env/src/server.ts's `configured()`) and the
  # compose profile stays off — an explicit, honest opt-out.
  if [ "$FIREWALL" = "true" ]; then
    crowdsec_bouncer_key="$(keep_or CROWDSEC_BOUNCER_KEY "$(random_secret)")"
    crowdsec_lapi_url="$(keep_or CROWDSEC_LAPI_URL "http://crowdsec:8080")"
    crowdsec_firewall_bouncer_key="$(keep_or CROWDSEC_FIREWALL_BOUNCER_KEY "$(random_secret)")"
    crowdsec_env_lines="CROWDSEC_BOUNCER_KEY=$crowdsec_bouncer_key
CROWDSEC_LAPI_URL=$crowdsec_lapi_url
# The native host firewall bouncer's own key (see provision_native_bouncer).
CROWDSEC_FIREWALL_BOUNCER_KEY=$crowdsec_firewall_bouncer_key"
  else
    crowdsec_env_lines="# Firewall disabled (OTTERDEPLOY_FIREWALL=false) — CROWDSEC_* left unset."
  fi
  # od-cse: anchor the auth authority at the address the dashboard is actually
  # reachable at, so the first visit works without an SSH tunnel. Reaching it
  # at some OTHER origin (loopback via tunnel, a LAN IP, a domain) still works
  # without re-running: packages/auth/src/index.ts:232-242 echoes any
  # same-origin request back as trusted, and the session cookie is set on the
  # request host. When the bind is pinned back to loopback, so is this.
  if [ "$control_plane_bind" = "127.0.0.1" ] || [ "$control_plane_bind" = "localhost" ]; then
    public_url="$(keep_or BETTER_AUTH_URL "http://127.0.0.1:$CONTROL_PLANE_PORT")"
  else
    public_url="$(keep_or BETTER_AUTH_URL "http://$server_ip:$CONTROL_PLANE_PORT")"
  fi
  cors_origin="$(keep_or CORS_ORIGIN "$public_url")"
  # Trust loopback plus the shared edge network's subnet, so forwarded
  # headers from the Caddy container are honored while anything else is
  # ignored (packages/api/src/security/trusted-proxy.ts).
  trusted_proxies="$(keep_or TRUSTED_PROXIES "$(detect_trusted_proxies)")"
  pool_line="$(env_value BRANCH_ZFS_POOL)"   # set later by provision_branching

  if dry; then
    say "   + write $ENV_FILE (secrets redacted):"
    say "       POSTGRES_USER=$pg_user  POSTGRES_DB=$pg_db  POSTGRES_PASSWORD=********"
    say "       DATABASE_URL=postgres://$pg_user:********@postgres:5432/$pg_db"
    say "       REDIS_URL=redis://redis:6379  BETTER_AUTH_SECRET=********"
    say "       OTTERDEPLOY_BOOTSTRAP_TOKEN=********"
    say "       OTTERDEPLOY_DATA_DIR=$DATA_DIR  OTTERDEPLOY_INSTALL_DIR=$INSTALL_DIR"
    say "       SERVER_IP=$server_ip  CONTROL_PLANE_PORT=$CONTROL_PLANE_PORT"
    say "       CONTROL_PLANE_BIND=$control_plane_bind"
    say "       BETTER_AUTH_URL=$public_url  CORS_ORIGIN=$cors_origin  NODE_ENV=production"
    say "       TRUSTED_PROXIES=$trusted_proxies"
    if [ "$FIREWALL" = "true" ]; then
      say "       CROWDSEC_BOUNCER_KEY=********  CROWDSEC_LAPI_URL=http://crowdsec:8080"
      say "       CROWDSEC_FIREWALL_BOUNCER_KEY=********"
    else
      say "       (firewall disabled — no CROWDSEC_* vars written)"
    fi
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
# Which host address the dashboard is published on. 0.0.0.0 = reachable at this
# machine's addresses (http://$server_ip:$CONTROL_PLANE_PORT); set 127.0.0.1 to
# publish to loopback only and reach it through a domain or an SSH tunnel.
CONTROL_PLANE_BIND=$control_plane_bind
# The address this host is reachable at. Read by packages/api/src/lib/server-ip.ts
# as the operator override, and used to build the sslip.io fallback domains
# (<app>-<project>.$server_ip.sslip.io) that let an exposed service have a
# working URL before you own a domain. Change it here if this box is reachable
# at a different address than the installer detected, then re-run.
SERVER_IP=$server_ip
# od-5j8.10: only these peers may set X-Forwarded-For/X-Forwarded-Proto —
# loopback plus the shared edge network (so the Caddy container is trusted).
# Detected from '$EDGE_NETWORK's subnet at install time; update if you change
# the edge network or front the dashboard with your own reverse proxy.
TRUSTED_PROXIES=$trusted_proxies

POSTGRES_USER=$pg_user
POSTGRES_PASSWORD=$pg_pass
POSTGRES_DB=$pg_db
DATABASE_URL=postgres://$pg_user:$pg_pass@postgres:5432/$pg_db
REDIS_URL=redis://redis:6379

BETTER_AUTH_SECRET=$auth_secret
# Required only for the first account. Account creation becomes invitation-only
# as soon as the installation owner exists.
OTTERDEPLOY_BOOTSTRAP_TOKEN=$bootstrap_token
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

# od-5j8.11: CrowdSec IP-reputation bouncer — bundled + wired automatically
# when the firewall is enabled (the default). packages/env/src/server.ts
# treats both as required together; the Caddyfile gains the "crowdsec" gate
# and the "firewall" compose profile starts as soon as these are set.
$crowdsec_env_lines
EOF
  say " - Secrets generated (and preserved across re-runs)"
  if [ "$IS_UPDATE" = true ]; then chip "secrets preserved"; else chip "secrets generated"; fi
}

report_bootstrap_token() {
  local token
  token="$(env_value OTTERDEPLOY_BOOTSTRAP_TOKEN)"
  [ -n "$token" ] || return 0

  # Bypass stdout/tee so this secret is shown to the controlling terminal but
  # never copied into the persistent installer log. On unattended/no-TTY runs,
  # point the operator at the root-readable env file instead.
  if [ -w /dev/tty ]; then
    {
      printf '\n\033[1mFirst-account bootstrap token\033[0m\n'
      printf '  %s\n' "$token"
      printf 'Paste this into the first sign-up form. Later accounts require an invitation.\n'
    } > /dev/tty
  else
    tsay "  First-account bootstrap token is in $ENV_FILE (root-readable)."
  fi
}

# ── 7. ZFS branching pool ───────────────────────────────────────────────────
# Copy-on-write preview/branch databases need a ZFS pool. We provision one with
# no hardware requirement via a file-backed vdev, so instant branching is on by
# default. If ZFS can't be set up we don't fail — the platform uses the logical
# (pg_dump) branching tier instead.
#
# Sizing: the vdev is a SPARSE file, so its size is a growth ceiling, not an
# upfront cost — but it must never promise more than the disk can deliver. An
# overcommitted pool suspends (hangs every branch DB at once) the moment the
# backing filesystem hits ENOSPC. Default: ¼ of the space available at
# $DATA_DIR, capped at 40G; below a 5G floor we skip ZFS entirely. Growing
# later is one command (shrinking is impossible without recreating the pool):
#   truncate -s +10G <img> && zpool online -e <pool> <img>

# Echo the pool size to use, or nothing when the disk is too small for a
# useful pool. An explicit OTTERDEPLOY_ZFS_SIZE is honored verbatim.
pool_size() {
  if [ -n "$ZFS_SIZE" ]; then printf '%s' "$ZFS_SIZE"; return; fi
  # df the deepest existing ancestor of DATA_DIR (it may not exist yet).
  target="$DATA_DIR"
  while [ ! -d "$target" ] && [ "$target" != "/" ]; do target="$(dirname "$target")"; done
  avail_kb="$(df -Pk "$target" 2>/dev/null | awk 'NR==2 {print $4}')"
  [ -n "$avail_kb" ] || return 0
  size_gb=$(( avail_kb / 1024 / 1024 / 4 ))
  [ "$size_gb" -lt 5 ] && return 0
  [ "$size_gb" -gt 40 ] && size_gb=40
  printf '%sG' "$size_gb"
}

provision_branching() {
  step "Setting up copy-on-write database branching (ZFS)"

  if [ "$BRANCHING" = "off" ]; then
    say " - Skipped (OTTERDEPLOY_BRANCHING=off); logical branching tier still works"
    phase_skip; chip "logical branching (opted out)"
    return
  fi

  if ! command -v zpool >/dev/null 2>&1; then
    if command -v apt-get >/dev/null 2>&1; then
      say " - Installing zfsutils-linux"
      run $SUDO apt-get install -y zfsutils-linux || true
    fi
  fi
  if dry; then
    size="$(pool_size)"
    if [ -n "$size" ]; then
      say "   + would create file-backed ZFS pool '$ZFS_POOL' ($size) at $ZFS_IMG (if absent)"
    else
      say "   + would skip the pool (<5G free at $DATA_DIR) → logical branching tier"
    fi
    say "   + would enable autotrim so deleted branch data returns to the host disk"
    say "   + would create+tune dataset '$ZFS_POOL/pg' (recordsize=16k atime=off)"
    say "   + would set BRANCH_ZFS_POOL=$ZFS_POOL in $ENV_FILE"
    say "   (no ZFS on host → platform would use the logical pg_dump tier instead)"
    return
  fi
  if ! command -v zpool >/dev/null 2>&1; then
    phase_skip; chip "logical branching"
    warn "Database branching is on the logical tier — ZFS is not available on this host. Branching still works; branches are full copies instead of instant. Nothing to do."
    return
  fi
  # Make sure the kernel module actually loads (managed/odd kernels can lack it).
  if ! $SUDO modprobe zfs 2>/dev/null && ! $SUDO zpool status >/dev/null 2>&1; then
    phase_skip; chip "logical branching"
    warn "Database branching is on the logical tier — this kernel won't load the ZFS module. Branching still works; branches are full copies instead of instant. Nothing to do."
    return
  fi

  if $SUDO zpool list -H -o name 2>/dev/null | grep -qx "$ZFS_POOL"; then
    say " - Reusing existing ZFS pool '$ZFS_POOL'"
  else
    size="$(pool_size)"
    if [ -z "$size" ]; then
      phase_skip; chip "logical branching"
      warn "Database branching is on the logical tier — less than 5G free at $DATA_DIR to host a copy-on-write pool. Branching still works; branches are full copies instead of instant. Free up disk and re-run to make them instant."
      return
    fi
    say " - Creating file-backed ZFS pool '$ZFS_POOL' ($size) at $ZFS_IMG"
    say "   (grows on demand from the dashboard; point OTTERDEPLOY_ZFS_POOL at a real disk for production-grade speed)"
    $SUDO mkdir -p "$DATA_DIR"
    if [ ! -f "$ZFS_IMG" ]; then
      $SUDO truncate -s "$size" "$ZFS_IMG"
    fi
    if ! $SUDO zpool create -f "$ZFS_POOL" "$ZFS_IMG"; then
      phase_skip; chip "logical branching"
      warn "Database branching is on the logical tier — creating the ZFS pool failed (see the log). Branching still works; branches are full copies instead of instant."
      return
    fi
  fi

  # Autotrim punches freed blocks back out of the sparse image file, so
  # deleting a branch returns real disk to the host (a sparse file otherwise
  # only ever grows). Set on reuse too — existing installs pick it up on
  # re-run. Harmless on a whole-disk pool.
  $SUDO zpool set autotrim=on "$ZFS_POOL" 2>/dev/null || true

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
  chip "instant branching (ZFS $ZFS_POOL)"
}

# ── 7b. host-level firewall (nftables baseline) ─────────────────────────────
# od-5j8.11: layer 1 of the two-layer defense — see
# docs/designs/vps-firewall-layering.md. Mirrors the ruleset
# packages/api/src/routers/server/host-firewall.ts renders for nodes added
# to the swarm afterward: SAME shape (table inet otterdeploy, default-deny
# INPUT except lo/established/ssh/80/443, swarm control-plane ports
# 2377/7946/4789 scoped to a peer set that starts empty on a single host) so
# `nft list ruleset` reads the same policy on every node in the fleet.
# Layer 2 (the native CrowdSec bouncer, provision_native_bouncer below) adds
# dynamic IP-reputation bans into the SAME table.
#
# Best-effort: NEVER blocks the install. Skips cleanly (narrated) when
# ufw/firewalld is already active — we don't fight an operator's existing
# choice — or when nftables can't be installed.
OTTERDEPLOY_NFT_RULESET=/etc/nftables-otterdeploy.conf

# "Is another firewall manager already in charge here?" Capture-then-match
# rather than `cmd | grep -q`: under pipefail a match makes grep close the pipe
# early, the producer dies of SIGPIPE, and the pipeline reports 141 — so a host
# that IS running ufw would read as "no ufw" and get nftables installed
# alongside it. Exactly the fight this check exists to avoid.
# od-2qk: match the status line EXACTLY. The previous glob was
# `*[Ss]tatus:*[Aa]ctive*`, whose middle `*` happily swallows the "in" of
# "Status: inactive" — so every host with ufw merely INSTALLED (the stock
# Ubuntu state: present, disabled) was read as firewalled, and the entire
# nftables baseline + DOCKER-USER guard were skipped with a note saying ufw
# had it covered. Anchor the whole line so the two states can't collide.
ufw_active() {
  command -v ufw >/dev/null 2>&1 || return 1
  $SUDO ufw status 2>/dev/null | grep -qiE '^status:[[:space:]]*active[[:space:]]*$'
}

firewalld_active() {
  command -v firewall-cmd >/dev/null 2>&1 || return 1
  [ "$($SUDO firewall-cmd --state 2>/dev/null || true)" = "running" ]
}

# od-cse: the TCP ports the platform itself needs open on this host. Caddy's
# edge is always 80/443; the control-plane port joins them whenever the
# dashboard is published to a real address rather than loopback.
#
# It has to feed BOTH chains. The `input` chain covers a host listener (the
# userland docker-proxy path), and the DOCKER-USER guard covers the DNAT'd
# forward path a published container port actually takes — an INPUT-only rule
# never sees it. Get this wrong and the dashboard binds 0.0.0.0 and is still
# unreachable, which is exactly the failure this whole change is undoing.
edge_tcp_ports() {
  local bind; bind="$(env_value CONTROL_PLANE_BIND)"
  [ -n "$bind" ] || bind="${OTTERDEPLOY_CONTROL_PLANE_BIND:-0.0.0.0}"
  case "$bind" in
    127.0.0.1|localhost) printf '80, 443' ;;
    *) printf '80, 443, %s' "$CONTROL_PLANE_PORT" ;;
  esac
}

# The CURRENT sshd port — never assumed to be 22, so a customized install
# can't get locked out. `ct state established,related accept` (in the
# ruleset below) means even a WRONG detection can't kill the session this
# installer is already running over; only a NEW connection would be refused.
detect_ssh_port() {
  local p
  # Two pipefail hazards, both of which used to abort the whole install here:
  #   * `sshd -T` exits non-zero when it can't read the config (not root, no
  #     sshd installed) — swallow it, the fallback below is the answer.
  #   * an awk that `exit`s on the first match closes the pipe while sshd is
  #     still writing, so sshd dies of SIGPIPE and pipefail reports 141.
  # Read the whole stream and keep the first match instead.
  p="$({ $SUDO sshd -T 2>/dev/null || true; } | awk '/^port /{ if (!seen++) port = $2 } END { print port }')"
  case "$p" in ''|*[!0-9]*) printf '22' ;; *) printf '%s' "$p" ;; esac
}

# Known limitation (documented in docs/designs/vps-firewall-layering.md
# §Drift detection / peer-set freshness): the control plane runs as an
# unprivileged CONTAINER (no host network namespace / NET_ADMIN), so it
# cannot update the PRIMARY's own nftables peer set when a node joins later
# — only a node ADDED via the dashboard gets a live peer set (computed from
# the server registry at provisioning time, over SSH — see
# provision-host-firewall.ts). Re-running this installer on the primary
# after adding nodes closes that gap: it re-reads current swarm membership
# from the LOCAL Docker socket (which this script — unlike the control
# plane — always has host-level access to) and re-renders the peer set.
# Space-separated IPv4 addresses; empty on a fresh single-node install.
detect_swarm_peer_ips() {
  # `docker info | grep -q` reads wrong under pipefail: grep closes the pipe on
  # the match, docker dies of SIGPIPE, and the pipeline reports 141 — i.e. a
  # SUCCESSFUL match looked like "swarm is not active" and silently emptied the
  # peer set. Ask docker for the single field instead. Same reason the grep
  # below is guarded: no matching node is a normal single-host install, not an
  # error worth aborting the install over.
  [ "$($SUDO docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null || true)" = "active" ] || return 0
  { $SUDO docker node ls -q 2>/dev/null || true; } | while read -r id; do
    $SUDO docker node inspect "$id" --format '{{.Status.Addr}}' 2>/dev/null || true
  done | { grep -E '^[0-9]+(\.[0-9]+){3}$' || true; } | sort -u | tr '\n' ' '
}

provision_host_firewall() {
  step "Applying host firewall (nftables baseline)"
  if [ "$FIREWALL" != "true" ]; then
    say " - Skipped (OTTERDEPLOY_FIREWALL=false)"
    phase_skip; chip "off (opted out)"
    return
  fi
  local ssh_port; ssh_port="$(detect_ssh_port)"
  if dry; then
    say "   + would install nftables (if missing) and load a default-deny table 'otterdeploy':"
    say "     allow loopback, established/related, SSH ($ssh_port/tcp), 80/443/tcp"
    say "     swarm ports 2377/7946/4789 stay peer-scoped (current swarm members, if any joined already)"
    say "   + would insert a DOCKER-USER guard dropping forwarded traffic to ports outside { $(edge_tcp_ports) }"
    say "   + would skip entirely if ufw/firewalld is already active"
    return
  fi
  if ufw_active; then
    say " - ufw is active — leaving it in place (otterdeploy will not install nftables alongside it)"
    phase_skip; chip "ufw left in place"
    warn "ufw was already managing this host's firewall, so the nftables baseline was not applied — otterdeploy does not fight an existing firewall. Open the ports it needs: sudo ufw allow 80,443/tcp. CrowdSec IP-reputation blocking is unaffected."
    return
  fi
  if firewalld_active; then
    say " - firewalld is active — leaving it in place"
    phase_skip; chip "firewalld left in place"
    warn "firewalld was already managing this host's firewall, so the nftables baseline was not applied. Make sure 80/tcp and 443/tcp are open. CrowdSec IP-reputation blocking is unaffected."
    return
  fi
  # od-yg9: refresh the package lists first. `apt-get update` runs exactly once
  # in this script — inside install_prereqs, and only when curl/git/jq/openssl
  # are MISSING. On the common host where they're already present it never
  # runs, so apt's lists can be stale or empty for the whole install and
  # `apt-get install nftables` fails with "Unable to locate package". The `||
  # true` then swallowed it and the firewall was skipped with a note blaming
  # the platform. host-firewall.ts:180-181 (the path for nodes added later)
  # always updated first; this one didn't.
  if ! command -v nft >/dev/null 2>&1; then
    case "$OS_FAMILY" in
      debian) run $SUDO apt-get update -y || true; run $SUDO apt-get install -y nftables || true ;;
      rhel)   run $SUDO dnf install -y nftables || true ;;
      arch)   run $SUDO pacman -Sy --noconfirm nftables || true ;;
    esac
  fi
  if ! command -v nft >/dev/null 2>&1; then
    phase_skip; chip "CrowdSec only"
    warn "The host-level nftables baseline could not be applied (nftables is unavailable here). CrowdSec still blocks hostile IPs at the edge, but this host has no default-deny rule — restrict inbound traffic another way if it is internet-facing."
    return
  fi
  run $SUDO mkdir -p /etc/otterdeploy
  # Peer set for the swarm control-plane ports — read from the LOCAL swarm
  # membership (this script, unlike the containerized control plane, always
  # has host-level `docker` access). Empty on a fresh single-node install;
  # re-running the installer after adding nodes refreshes it (see
  # detect_swarm_peer_ips's doc comment for why this isn't fully automatic).
  local peers peer_set_body
  peers="$(detect_swarm_peer_ips)"
  if [ -n "$(printf '%s' "$peers" | tr -d '[:space:]')" ]; then
    peer_set_body="$(printf '\t\ttype ipv4_addr\n\t\telements = { %s }' "$(echo "$peers" | sed 's/ *$//;s/ /, /g')")"
  else
    peer_set_body="$(printf '\t\ttype ipv4_addr')"
  fi
  {
    printf 'table inet otterdeploy {\n'
    printf '\tset otterdeploy_peers {\n%s\n\t}\n\n' "$peer_set_body"
    printf '\tchain input {\n'
    printf '\t\ttype filter hook input priority filter; policy drop;\n'
    printf '\t\tiif "lo" accept\n'
    printf '\t\tct state invalid drop\n'
    printf '\t\tct state established,related accept\n'
    printf '\t\ticmp type { echo-request, destination-unreachable, time-exceeded } accept\n'
    printf '\t\ticmpv6 type { echo-request, nd-neighbor-solicit, nd-neighbor-advert, destination-unreachable, time-exceeded } accept\n'
    printf '\t\ttcp dport %s accept\n' "$ssh_port"
    printf '\t\ttcp dport { %s } accept\n' "$(edge_tcp_ports)"
    printf '\t\ttcp dport { 2377, 7946 } ip saddr @otterdeploy_peers accept\n'
    printf '\t\tudp dport { 7946, 4789 } ip saddr @otterdeploy_peers accept\n'
    printf '\t}\n}\n'
  } | $SUDO tee "$OTTERDEPLOY_NFT_RULESET" >/dev/null
  if ! $SUDO nft -c -f "$OTTERDEPLOY_NFT_RULESET"; then
    warn "generated nftables ruleset failed validation — NOT applied. See $OTTERDEPLOY_NFT_RULESET."
    return
  fi
  if [ -f /etc/nftables.conf ]; then
    grep -qxF "include \"$OTTERDEPLOY_NFT_RULESET\"" /etc/nftables.conf \
      || $SUDO sh -c "echo 'include \"$OTTERDEPLOY_NFT_RULESET\"' >> /etc/nftables.conf"
  else
    $SUDO sh -c "printf '#!/usr/sbin/nft -f\ninclude \"$OTTERDEPLOY_NFT_RULESET\"\n' > /etc/nftables.conf"
  fi
  $SUDO systemctl enable nftables >/dev/null 2>&1 || true
  $SUDO nft -f "$OTTERDEPLOY_NFT_RULESET"
  # DOCKER-USER guard — defense in depth: Docker manipulates iptables/nftables
  # DIRECTLY for published container ports (the classic ufw+Docker footgun —
  # a published port never touches the INPUT chain above), so an accidental
  # extra `-p hostport:containerport` publish is blocked here instead.
  if $SUDO nft list chain ip filter DOCKER-USER >/dev/null 2>&1; then
    $SUDO nft -a list chain ip filter DOCKER-USER 2>/dev/null | awk '/otterdeploy-guard/{print $NF}' \
      | while read -r h; do $SUDO nft delete rule ip filter DOCKER-USER handle "$h"; done
    $SUDO nft insert rule ip filter DOCKER-USER tcp dport != { $(edge_tcp_ports) } ct state new counter drop comment "otterdeploy-guard"
  fi
  say " - nftables baseline active (SSH $ssh_port, $(edge_tcp_ports), swarm ports peer-scoped)"
  chip "nftables baseline"
  say "   Rollback if needed: sudo nft delete table inet otterdeploy   (or: $(self_cmd) firewall-rollback)"
}

# ── 7c. native CrowdSec firewall bouncer on the primary ─────────────────────
# od-5j8.11: the manager-parity gap this closed — the compose file has
# always accepted a CROWDSEC_FIREWALL_BOUNCER_KEY (auto-registering it via
# CrowdSec's own BOUNCER_KEY_<name> convention), but nothing ever installed
# the HOST-SIDE systemd bouncer that key is for; only nodes added later
# (provision-firewall.ts) got one. Mirrors that same script almost exactly —
# it just runs locally instead of over SSH.
provision_native_bouncer() {
  step "Installing native CrowdSec firewall bouncer (host-level enforcement)"
  if [ "$FIREWALL" != "true" ]; then
    say " - Skipped (OTTERDEPLOY_FIREWALL=false)"
    return
  fi
  if dry; then
    say "   + would install crowdsec-firewall-bouncer-nftables and point it at the local LAPI"
    return
  fi
  local key lapi_bind lapi_url
  key="$(env_value CROWDSEC_FIREWALL_BOUNCER_KEY)"
  if [ -z "$key" ]; then
    say " - No CROWDSEC_FIREWALL_BOUNCER_KEY in $ENV_FILE — skipping"
    return
  fi
  lapi_bind="$(env_value CROWDSEC_LAPI_BIND)"; [ -z "$lapi_bind" ] && lapi_bind="127.0.0.1"
  lapi_url="http://$lapi_bind:8080/"
  if ! command -v crowdsec-firewall-bouncer >/dev/null 2>&1; then
    if ! command -v apt-get >/dev/null 2>&1 && [ "$OS_FAMILY" != "rhel" ]; then
      warn "crowdsec-firewall-bouncer has no package for this distro ($OS_PRETTY) — install it manually: https://docs.crowdsec.net/u/bouncers/firewall"
      return
    fi
    local pc_env=""
    if [ -r /etc/os-release ]; then
      # shellcheck disable=SC1091
      . /etc/os-release
      [ "${ID:-}" = "ubuntu" ] && pc_env="os=ubuntu dist=noble"
    fi
    curl -s https://packagecloud.io/install/repositories/crowdsec/crowdsec/script.deb.sh | $SUDO env $pc_env bash
    case "$OS_FAMILY" in
      debian) run $SUDO apt-get install -y crowdsec-firewall-bouncer-nftables ;;
      rhel)   run $SUDO dnf install -y crowdsec-firewall-bouncer-nftables 2>/dev/null || run $SUDO yum install -y crowdsec-firewall-bouncer-nftables ;;
    esac
  fi
  if ! command -v crowdsec-firewall-bouncer >/dev/null 2>&1; then
    warn "crowdsec-firewall-bouncer install failed — the Caddy-edge bouncer (BOUNCER_KEY_caddy) still protects HTTP traffic; host-level enforcement is missing."
    return
  fi
  run $SUDO mkdir -p /etc/crowdsec/bouncers
  $SUDO tee /etc/crowdsec/bouncers/crowdsec-firewall-bouncer.yaml >/dev/null <<BOUNCER_EOF
mode: nftables
update_frequency: 10s
log_mode: file
log_dir: /var/log/
log_level: info
api_url: $lapi_url
api_key: $key
BOUNCER_EOF
  $SUDO chmod 600 /etc/crowdsec/bouncers/crowdsec-firewall-bouncer.yaml
  if ! curl -s -m 5 -o /dev/null "${lapi_url%/}health"; then
    warn "LAPI $lapi_url not reachable yet — normal if the crowdsec container is still starting; the bouncer service retries on its own."
  fi
  $SUDO systemctl enable --now crowdsec-firewall-bouncer >/dev/null 2>&1 || true
  if $SUDO systemctl is-active crowdsec-firewall-bouncer >/dev/null 2>&1; then
    say " - Native firewall bouncer active (LAPI $lapi_url)"
  else
    warn "crowdsec-firewall-bouncer did not start — check: systemctl status crowdsec-firewall-bouncer"
  fi
}

# `install.sh firewall-rollback` — the documented, tested-by-inspection
# recovery path (od-5j8.11 acceptance: "lockout recovery is documented").
# The whole host ruleset lives in ONE named table, so removing it is a
# single atomic, safe command — it can never partially apply.
firewall_rollback() {
  say "Rolling back the otterdeploy host firewall…"
  if ! command -v nft >/dev/null 2>&1; then
    say "nft not installed — nothing to roll back."
    return 0
  fi
  if $SUDO nft delete table inet otterdeploy 2>/dev/null; then
    say "Removed table 'inet otterdeploy' — host firewall fully reverted."
  else
    say "No 'inet otterdeploy' table present — nothing to roll back."
  fi
  say ""
  say "The DOCKER-USER guard rule (if inserted) is left in place by design — it's independent of"
  say "the otterdeploy table. To remove it too:"
  say "  sudo nft -a list chain ip filter DOCKER-USER   # find the handle tagged 'otterdeploy-guard'"
  say "  sudo nft delete rule ip filter DOCKER-USER handle <N>"
}

# `install.sh firewall-status` — read-only inspection of both layers.
firewall_status_cmd() {
  say "Host firewall (nftables):"
  if command -v nft >/dev/null 2>&1 && $SUDO nft list table inet otterdeploy >/dev/null 2>&1; then
    say "  table 'inet otterdeploy': present"
  else
    say "  table 'inet otterdeploy': absent"
  fi
  say ""
  say "Native CrowdSec bouncer:"
  if command -v systemctl >/dev/null 2>&1 && $SUDO systemctl is-active crowdsec-firewall-bouncer >/dev/null 2>&1; then
    say "  crowdsec-firewall-bouncer: active"
  else
    say "  crowdsec-firewall-bouncer: inactive or not installed"
  fi
  say ""
  say "CrowdSec agent + Caddy edge bouncer: check with"
  say "  sudo docker compose -f $COMPOSE_FILE --env-file $ENV_FILE ps crowdsec caddy"
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

  # Count what actually came up, for the terminal summary.
  local n
  n="$($SUDO docker compose "${COMPOSE_F[@]}" --env-file "$ENV_FILE" ps -q 2>/dev/null | grep -c . || true)"
  case "$n" in ''|*[!0-9]*) : ;; 0) : ;; *) chip "$n services" ;; esac
}

# Don't declare success until the control plane actually answers — never show a
# green banner pointing at a dead port. On timeout, dump logs and fail.
wait_for_health() {
  step "Waiting for the control plane (port $CONTROL_PLANE_PORT)"
  dry && { say "   + would poll http://localhost:$CONTROL_PLANE_PORT until it responds"; return; }
  local i=0
  while [ "$i" -lt 45 ]; do
    if curl -fsS -o /dev/null --max-time 3 "http://localhost:$CONTROL_PLANE_PORT/" 2>/dev/null; then
      say " - Control plane is responding"
      chip "healthy in $((i * 2))s"
      return 0
    fi
    i=$((i + 1)); sleep 2
  done
  # Capture the container logs into the install log (quiet mode has no "above"
  # to point at), then say exactly where to look.
  say "Control plane did not respond within ~90s. Recent container logs:"
  compose_f_args
  $SUDO docker compose "${COMPOSE_F[@]}" --env-file "$ENV_FILE" logs --tail 200 >&2 2>/dev/null || true
  fail "otterdeploy started but never became healthy. The container logs are at the end of $LOG_FILE — that is where the reason will be."
}

# ── version resolution ────────────────────────────────────────────────────────
# Images are published under immutable semver tags (vX.Y.Z) alongside a GitHub
# Release per tag (.github/workflows/images.yml). Resolve the newest release so
# the stack boots pinned; the fallback order keeps every situation safe:
#   pinned via env  →  releases/latest  →  existing .env pin  →  `latest`.
resolve_version() {
  step "Resolving version"
  if [ -n "$VERSION" ]; then
    say " - $VERSION (pinned via OTTERDEPLOY_VERSION)"
    chip "$VERSION (pinned)"
    return 0
  fi
  local tag
  tag="$(curl -fsSL --max-time 10 -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/$RELEASE_REPO/releases/latest" 2>/dev/null \
    | sed -n 's/.*"tag_name":[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
  if [ -n "$tag" ]; then
    VERSION="$tag"
    say " - $VERSION (latest release of $RELEASE_REPO)"
    chip "$VERSION"
    return 0
  fi
  # Lookup failed (offline, rate-limited, or no release published yet). Never
  # DOWNGRADE an existing pin to the moving tag over a transient failure.
  VERSION="$(env_value OTTERDEPLOY_VERSION)"
  if [ -n "$VERSION" ]; then
    say " - $VERSION (kept from existing .env — release lookup failed)"
    chip "$VERSION"
  else
    VERSION="latest"
    warn "Could not resolve the latest release of $RELEASE_REPO — using the moving '$VERSION' tag. In-app updates pin to a release on first apply; or re-run the installer once a release is published."
  fi
}

# Bump the pinned tag in an existing .env — the same edit the in-app update
# helper makes — so what `compose pull` fetches and what the dashboard reports
# as its version can't drift apart.
pin_version_in_env() {
  [ -f "$ENV_FILE" ] || return 0
  [ "$(env_value OTTERDEPLOY_VERSION)" = "$VERSION" ] && return 0
  if grep -q '^OTTERDEPLOY_VERSION=' "$ENV_FILE" 2>/dev/null; then
    run $SUDO sed -i "s|^OTTERDEPLOY_VERSION=.*|OTTERDEPLOY_VERSION=$VERSION|" "$ENV_FILE"
  else
    run $SUDO sh -c "printf 'OTTERDEPLOY_VERSION=%s\n' '$VERSION' >> '$ENV_FILE'"
  fi
  say " - Pinned OTTERDEPLOY_VERSION=$VERSION in $ENV_FILE"
}

# `install.sh update` — re-fetch the compose, pin the newest release tag, pull,
# restart. Skips host setup entirely and never touches secrets.
update_stack() {
  [ -f "$COMPOSE_FILE" ] || fail "No existing install at $COMPOSE_FILE — run the installer first."
  say "Updating otterdeploy (pull + restart) — secrets preserved…"
  phase Update "Updating otterdeploy"
  resolve_version
  pin_version_in_env
  prepare_tree
  start_stack
  wait_for_health
  phase_end
  report_notes
  tsay ""
  printf '  \033[32motterdeploy updated to %s.\033[0m\n' "$VERSION" >&3
  report_access
}

# Everything warn() collected, once, at the end — where it reads as a
# checklist rather than as the install falling over mid-run. Each note says
# what it means for the operator, not just what the script observed.
report_notes() {
  if [ "${#NOTES[@]}" -eq 0 ]; then return 0; fi
  tsay ""
  printf '  \033[33mNotes (%s)\033[0m — the install succeeded; these are worth knowing\n' \
    "${#NOTES[@]}" >&3
  local n
  for n in "${NOTES[@]}"; do
    printf '   · %s\n' "$n" | fold -s -w 74 | sed -e 's/[[:space:]]*$//' -e '2,$s/^/     /' >&3
  done
  return 0
}

print_firewall_hint() {
  if ufw_active; then
    tsay ""
    tsay "  Firewall   ufw was already active, so otterdeploy left it alone and did not"
    tsay "             apply its own baseline. Be aware of what ufw does NOT cover:"
    tsay "             Docker publishes container ports straight into the FORWARD"
    tsay "             chain, ahead of ufw's rules, so every published port on this"
    tsay "             host — including 80/443 — is already reachable regardless of"
    tsay "             what ufw allows or denies. 'ufw allow 80,443/tcp' is a no-op"
    tsay "             for this stack; ufw still governs non-Docker host listeners."
    tsay "             (CrowdSec enforces IP reputation either way.)"
    return 0
  fi
  tsay ""
  if [ "$FIREWALL" = "true" ]; then
    tsay "  Firewall   nftables baseline + CrowdSec are on."
    tsay "             inspect   $(self_cmd) firewall-status"
    tsay "             rollback  $(self_cmd) firewall-rollback   (host table only)"
  else
    tsay "  Firewall   off. Re-run with --firewall to enable the nftables"
    tsay "             baseline + CrowdSec IP-reputation blocking."
  fi
  return 0
}

# od-cse/od-k5q: finish with a URL the operator can open, not homework. The
# dashboard binds all interfaces by default (CONTROL_PLANE_BIND), so print the
# detected address first and every other address this host answers on after it
# — detection can't tell which one is routable for the caller, and an operator
# behind NAT should not have to work that out themselves.
report_access() {
  local ssh_host ssh_user server_ip bind others ip

  tsay ""
  printf '  \033[32motterdeploy is up.\033[0m\n' >&3
  report_bootstrap_token
  server_ip="$(env_value SERVER_IP)"; [ -n "$server_ip" ] || server_ip="$(detect_server_ip)"
  bind="$(env_value CONTROL_PLANE_BIND)"; [ -n "$bind" ] || bind="0.0.0.0"
  tsay ""

  if [ "$bind" = "127.0.0.1" ] || [ "$bind" = "localhost" ]; then
    ssh_user="$(id -un 2>/dev/null || echo root)"
    ssh_host="$(hostname -f 2>/dev/null || hostname 2>/dev/null || echo "<this-host>")"
    tsay "  Dashboard  http://127.0.0.1:$CONTROL_PLANE_PORT  (bound to loopback — CONTROL_PLANE_BIND"
    tsay "             is 127.0.0.1, so it is not reachable from your LAN or the internet)"
    tsay ""
    tsay "             Reach it now, over SSH:"
    tsay "               ssh -L $CONTROL_PLANE_PORT:localhost:$CONTROL_PLANE_PORT $ssh_user@$ssh_host"
    tsay "               then open http://localhost:$CONTROL_PLANE_PORT"
  else
    tsay "  Dashboard  http://$server_ip:$CONTROL_PLANE_PORT"
    others="$(detect_private_ips "$server_ip")"
    if [ -n "$others" ]; then
      tsay ""
      tsay "             If that address isn't reachable from where you are, this host"
      tsay "             also answers on:"
      while read -r ip; do
        [ -n "$ip" ] && tsay "               http://$ip:$CONTROL_PLANE_PORT"
      done <<< "$others"
    fi
    tsay ""
    tsay "             Plain HTTP on an IP — fine for setup, not for daily use. Pin it"
    tsay "             to loopback any time with CONTROL_PLANE_BIND=127.0.0.1 in"
    tsay "             $ENV_FILE, then re-run."
  fi

  tsay ""
  tsay "             For HTTPS, point a domain at this host and set it as the"
  tsay "             control-plane domain in Settings → Networking. Caddy is already"
  tsay "             listening on 80/443 and will front the dashboard."
  tsay ""
  tsay "  Your apps  Exposed services get a working URL with no domain and no DNS"
  tsay "             setup: <app>-<project>.$server_ip.sslip.io, served by Caddy on"
  tsay "             80/443. Wrong address? Edit SERVER_IP in $ENV_FILE and re-run,"
  tsay "             or change it in Settings → Networking."
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

  # NOT prompted: the compose source. Where the stack definition is fetched
  # from is our packaging detail, not an operator's decision — asking made
  # every normal install answer a question that has exactly one right answer.
  # OTTERDEPLOY_COMPOSE_URL still overrides it for air-gapped/self-hosted
  # mirrors; that's an env var for people who already know they need it.

  # 2) Firewall — od-5j8.11: ON by default (the product's headline
  #    differentiator). Community IP-reputation blocking (CrowdSec) at both
  #    the Caddy edge AND the host, plus a default-deny nftables baseline.
  _ctx ""
  _ctx "Firewall — CrowdSec IP-reputation blocking (edge + host) and a default-deny"
  _ctx "nftables baseline, protecting SSH/edge traffic on this host out of the box."
  _ctx "Recommended to leave ON; you can disable it later (OTTERDEPLOY_FIREWALL=false)."
  if [ -z "${OTTERDEPLOY_FIREWALL:-}" ]; then
    local fw
    printf '   \033[1mEnable the bundled firewall (CrowdSec + nftables)?\033[0m [Y/n]: ' > "$tty"
    IFS= read -r fw < "$tty" || fw=""
    case "$fw" in [Nn]*) FIREWALL=false ;; *) FIREWALL=true ;; esac
  fi

  printf '\n   Config → branching=%s  firewall=%s\n' "$BRANCHING" "$FIREWALL" > "$tty"
}

usage() {
  cat <<EOF
otterdeploy installer

  curl -fsSL https://get.otterdeploy.com/install.sh | bash
  curl -fsSL https://get.otterdeploy.com/install.sh | bash -s -- --dry-run

Subcommands:
  (none)              Install / re-install.
  update              Pull the new image tag and restart; skips host setup.
  firewall-status     Inspect the host nftables table + native CrowdSec bouncer.
  firewall-rollback   Remove the host nftables table (documented lockout recovery —
                      the CrowdSec containers/profile are untouched by this).

Flags:
  -n, --dry-run    Preview every action; change nothing on the host.
  -y, --yes        Don't prompt; use env vars + defaults (unattended install).
  -v, --verbose    Show every step on screen as it runs. Without it you get one
                   line per phase and the full detail goes to the install log.
      --firewall   Force-enable the bundled firewall (CrowdSec + nftables) — the default.
      --no-firewall  Opt out of the bundled firewall entirely.
  -h, --help       Show this help.

Run \`bash install.sh\` on a terminal and it asks for the two options worth a
decision (database branching, firewall) before installing. Piped \`curl | bash\`,
--yes, --dry-run, or no TTY skip the prompts and use env vars + defaults. Any
OTTERDEPLOY_* env var that's set is used as-is (that prompt is skipped). All
flags have env-var equivalents (see header), e.g. OTTERDEPLOY_YES=true.

The bundled firewall (od-5j8.11) is ON BY DEFAULT: CrowdSec's bouncer key/LAPI wiring
is generated automatically, the \`firewall\` compose profile starts, a default-deny
nftables baseline is applied to this host (skipped, narrated, if ufw/firewalld is
already active), and — for servers added later via the dashboard — the same nftables
baseline + a per-node CrowdSec bouncer are installed during provisioning. Opt out with
OTTERDEPLOY_FIREWALL=false / --no-firewall.
EOF
}

main() {
  local mode="install"
  for arg in "$@"; do
    case "$arg" in
      update)             mode="update" ;;
      firewall-status)    mode="firewall-status" ;;
      firewall-rollback)  mode="firewall-rollback" ;;
      -n|--dry-run)       DRY_RUN=true ;;
      -y|--yes)           ASSUME_YES=true ;;
      -v|--verbose)       VERBOSE=true ;;
      --firewall)         FIREWALL=true ;;
      --no-firewall)      FIREWALL=false ;;
      -h|--help)          usage; exit 0 ;;
      *) fail "Unknown argument: $arg (try --help)" ;;
    esac
  done

  if [ "$mode" = "firewall-status" ]; then
    firewall_status_cmd
    return
  fi
  if [ "$mode" = "firewall-rollback" ]; then
    firewall_rollback
    return
  fi

  # Ask for the main options on a fresh install when run interactively (no-op
  # under --yes / --dry-run / no TTY). Must run BEFORE the log capture so a
  # changed DATA_DIR repoints INSTALL_DIR / LOG_FILE.
  [ "$mode" = "install" ] && configure

  # Capture the whole run to a timestamped log (curl|bash has no scrollback).
  # Quiet mode sends the narration to the log ONLY and keeps the terminal for
  # the phase summary; --verbose tees it to both. If the log can't be opened we
  # fall back to narrating on screen rather than silently losing the record.
  if [ "$DRY_RUN" != "true" ]; then
    mkdir -p "$INSTALL_DIR" 2>/dev/null || $SUDO mkdir -p "$INSTALL_DIR" || true
    if [ -w "$INSTALL_DIR" ]; then
      LOG_ACTIVE=true
      if [ "$VERBOSE" = "true" ]; then
        exec > >(tee -a "$LOG_FILE") 2>&1
      else
        exec >>"$LOG_FILE" 2>&1
      fi
    else
      VERBOSE=true
    fi
  else
    VERBOSE=true   # a dry run IS the detail; there's nothing to summarize
  fi
  trap 'on_error $?' ERR
  [ -f "$ENV_FILE" ] && IS_UPDATE=true

  say "=========================================="
  say "  otterdeploy installer — $DATE"
  [ "$mode" = "update" ] && say "  MODE: update"
  [ "$DRY_RUN" = "true" ] && say "  DRY RUN — no changes will be made"
  say "=========================================="

  # The terminal header. In verbose/dry-run mode stdout is already the screen,
  # so the banner above is enough — don't print it twice.
  if [ "$VERBOSE" != "true" ]; then
    tsay ""
    tsay "$(printf '\033[1motterdeploy\033[0m → %s' "$DATA_DIR")"
    tsay ""
  fi

  migrate_legacy_install

  if [ "$mode" = "update" ]; then
    update_stack
    return
  fi

  # Phases group the 17 internal steps into the six outcomes an operator
  # actually tracks. Each is one line on the terminal; the steps inside it keep
  # narrating into the log exactly as before.
  phase Host      "Checking the host"
  preflight
  install_prereqs
  provision_swap

  phase Docker    "Setting up Docker"
  if [ -n "$DOCKER_VER" ]; then chip "docker $DOCKER_VER"; fi
  configure_docker_pool
  ensure_swarm
  ensure_network

  # resolve_version moved in here from the Docker group: it is a plain network
  # lookup that only needs curl (installed above), and the release tag it picks
  # is what write_env pins — so it reads as part of "configuration", and its
  # version lands on the Config line where an operator looks for it.
  phase Config    "Writing configuration"
  resolve_version
  prepare_tree
  write_env

  phase Storage   "Preparing storage"
  provision_branching

  phase Firewall  "Applying the firewall"
  provision_host_firewall

  phase Services  "Starting otterdeploy"
  start_stack
  wait_for_health
  provision_native_bouncer
  phase_end

  if [ "$DRY_RUN" = "true" ]; then
    say ""
    say "Dry run complete — nothing was changed. Re-run without --dry-run to install."
    return
  fi

  report_notes
  report_access
  print_firewall_hint
  tsay ""
  tsay "  Files      compose $COMPOSE_FILE"
  tsay "             data    $DATA_DIR"
  tsay "             config  $ENV_FILE"
  tsay "             log     $LOG_FILE"
  tsay ""
  tsay "  Manage it  sudo docker compose -f $COMPOSE_FILE --env-file $ENV_FILE ps"
  tsay "             sudo docker compose -f $COMPOSE_FILE --env-file $ENV_FILE logs -f"
  tsay "             curl -fsSL https://get.otterdeploy.com/install.sh | sudo bash -s -- update"
  tsay ""
}

main "$@"
