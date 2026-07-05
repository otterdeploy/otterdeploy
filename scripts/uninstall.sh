#!/usr/bin/env bash
#
# otterdeploy uninstaller — removes the platform and (as much as you choose of)
# everything it created. DESTRUCTIVE and IRREVERSIBLE.
#
# Run with NO flags to pick interactively what to delete, then type "wipe":
#   sudo bash uninstall.sh
#
# Or preview / preset non-interactively:
#   sudo bash uninstall.sh --dry-run     # show every action, change nothing
#   sudo bash uninstall.sh --yes         # no prompts, use the defaults below
#
# Per-item flags (skip that prompt; also usable with --yes):
#   --keep-volumes   keep app/database docker volumes   (default: delete)
#   --keep-data      keep /data/otterdeploy on disk      (default: delete)
#   --base-images    also remove postgres/redis images   (default: keep)
#   --keep-zfs       keep the ZFS branching pool          (default: destroy)
#   --keep-swarm     stay in Docker Swarm                 (default: leave)
#   --remove-docker  remove Docker engine entirely        (default: keep)
#   --keep-docker    keep Docker engine                   (explicit)
#
# ALWAYS removed (this is what "uninstall otterdeploy" means): the compose stack,
# every provisioned container (label otterdeploy.managed), the otterdeploy
# networks, and the ghcr.io/otterdeploy/* images.

set -Eeuo pipefail

# ── options ('' = ask when interactive / use default when --yes) ──────────────
DRY_RUN=false; ASSUME_YES=false
KEEP_VOLUMES=''; KEEP_DATA=''; BASE_IMAGES=''; KEEP_ZFS=''; KEEP_SWARM=''; KEEP_DOCKER=''
for a in "$@"; do case "$a" in
  -n|--dry-run)    DRY_RUN=true ;;
  -y|--yes)        ASSUME_YES=true ;;
  --keep-volumes)  KEEP_VOLUMES=true ;;
  --keep-data)     KEEP_DATA=true ;;
  --base-images)   BASE_IMAGES=true ;;
  --keep-zfs)      KEEP_ZFS=true ;;
  --keep-swarm)    KEEP_SWARM=true ;;
  --keep-docker)   KEEP_DOCKER=true ;;
  --remove-docker) KEEP_DOCKER=false ;;
  -h|--help)       sed -n '2,32p' "$0"; exit 0 ;;
  *) echo "unknown arg: $a (try --help)"; exit 1 ;;
esac; done

DATA_DIR="${OTTERDEPLOY_DATA_DIR:-/data/otterdeploy}"
NETWORK="${OTTERDEPLOY_NETWORK:-otterdeploy}"
ZFS_POOL="${OTTERDEPLOY_ZFS_POOL:-otter}"
PROJECT="otterdeploy"
INSTALL_DIRS=("$DATA_DIR/source" "/opt/otterdeploy")
MANAGED="otterdeploy.managed"

if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null 2>&1 || { echo "Run as root (or install sudo)."; exit 1; }
  SUDO="sudo"
else SUDO=""; fi

step() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
say()  { printf '   %s\n' "$*"; }
run()  { if $DRY_RUN; then printf '   + %s\n' "$*"; else printf '   $ %s\n' "$*"; "$@"; fi; }
sh_()  { if $DRY_RUN; then printf '   + %s\n' "$*"; else printf '   $ %s\n' "$*"; $SUDO sh -c "$*"; fi; }
D()    { $SUDO docker "$@"; }

# ask_yn "Question" DEFAULT(Y|N)  → 0=yes 1=no  (Enter takes the default)
ask_yn() {
  local q="$1" def="$2" ans hint
  [ "$def" = Y ] && hint='[Y/n]' || hint='[y/N]'
  printf '   %s %s ' "$q" "$hint"; read -r ans; ans="${ans:-$def}"
  case "$ans" in [Yy]*) return 0 ;; *) return 1 ;; esac
}
# resolve one selectable var: if unset, ask (interactive) or take the default.
# choose VAR "Question" YESVAL DEFAULTKEY  — sets VAR to YESVAL / (not YESVAL).
pick() { # pick VARNAME prompt default(Y|N) meaning:  sets VARNAME=true/false
  local __var="$1" __q="$2" __def="$3"
  [ -n "${!__var}" ] && return 0                          # already set by a flag
  if $ASSUME_YES || $DRY_RUN; then
    [ "$__def" = Y ] && printf -v "$__var" true || printf -v "$__var" false
  else
    if ask_yn "$__q" "$__def"; then printf -v "$__var" true; else printf -v "$__var" false; fi
  fi
}

# ── inventory ─────────────────────────────────────────────────────────────────
step "otterdeploy footprint on $(hostname)"
say  "Stack containers          : $(D ps -aq --filter "label=com.docker.compose.project=$PROJECT" 2>/dev/null | wc -l)"
say  "Provisioned containers    : $(D ps -aq --filter "label=$MANAGED" 2>/dev/null | wc -l)"
say  "Volumes (app + DB data)   : $(D volume ls --format '{{.Name}}' 2>/dev/null | grep -cE '^otterdeploy' || true)"
say  "Networks                  : $(D network ls --format '{{.Name}}' 2>/dev/null | grep -cE "^$NETWORK$|^otterdeploy(-|_)" || true)"
say  "otterdeploy images        : $(D images --format '{{.Repository}}' 2>/dev/null | grep -cE 'otterdeploy' || true)"
say  "ZFS pool '$ZFS_POOL'          : $(command -v zpool >/dev/null 2>&1 && $SUDO zpool list "$ZFS_POOL" >/dev/null 2>&1 && echo present || echo absent)"

# ── selection ─────────────────────────────────────────────────────────────────
step "Choose what to delete"
[ "$DRY_RUN" = true ] && say "(dry-run: using defaults)"
pick KEEP_VOLUMES "Keep app/database volumes (their data)?"       N   # default: delete → keep=No
pick KEEP_DATA    "Keep $DATA_DIR (builds, backups, caddy)?"       N
pick BASE_IMAGES  "Also remove base images (postgres/redis)?"      N   # default: keep → remove=No
pick KEEP_ZFS     "Keep the ZFS branching pool '$ZFS_POOL'?"           N
pick KEEP_SWARM   "Stay in Docker Swarm?"                          N
pick KEEP_DOCKER  "Keep Docker installed (No = remove Docker)?"    Y

# ── final plan ────────────────────────────────────────────────────────────────
step "Plan"
say "Remove stack + provisioned containers + networks + otterdeploy images : YES"
say "Remove volumes (app/DB data)  : $($KEEP_VOLUMES && echo 'no (kept)' || echo YES)"
say "Remove base images pg/redis   : $($BASE_IMAGES && echo YES || echo 'no')"
say "Destroy ZFS pool '$ZFS_POOL'      : $($KEEP_ZFS && echo 'no (kept)' || echo YES)"
say "Leave Docker Swarm            : $($KEEP_SWARM && echo 'no (stay)' || echo YES)"
say "Delete $DATA_DIR : $($KEEP_DATA && echo 'no (kept)' || echo YES)"
say "Remove Docker engine          : $($KEEP_DOCKER && echo 'no (kept)' || echo YES)"

# ── confirm ───────────────────────────────────────────────────────────────────
if ! $DRY_RUN && ! $ASSUME_YES; then
  printf '\n\033[31mThis is permanent.\033[0m Type "wipe" to proceed: '
  read -r ans; [ "$ans" = wipe ] || { echo "Aborted."; exit 1; }
fi

# ── 1. stack ──────────────────────────────────────────────────────────────────
step "Stopping the otterdeploy stack"
vflag=""; $KEEP_VOLUMES || vflag="-v"
for d in "${INSTALL_DIRS[@]}"; do
  [ -f "$d/docker-compose.yml" ] &&
    run $SUDO docker compose -p "$PROJECT" -f "$d/docker-compose.yml" --env-file "$d/.env" down $vflag --remove-orphans || true
done
sh_ "docker rm -f \$(docker ps -aq --filter label=com.docker.compose.project=$PROJECT) 2>/dev/null || true"

# ── 2. provisioned containers ─────────────────────────────────────────────────
step "Removing provisioned containers (label $MANAGED)"
sh_ "docker rm -f \$(docker ps -aq --filter label=$MANAGED) 2>/dev/null || true"

# ── 3. networks ───────────────────────────────────────────────────────────────
step "Removing networks"
sh_ "docker network rm \$(docker network ls -q --filter label=$MANAGED) 2>/dev/null || true"
sh_ "docker network ls --format '{{.Name}}' | grep -E '^${NETWORK}\$|^otterdeploy(-|_)' | xargs -r -n1 docker network rm 2>/dev/null || true"

# ── 4. volumes ────────────────────────────────────────────────────────────────
if ! $KEEP_VOLUMES; then
  step "Removing volumes (app + database data)"
  sh_ "docker volume rm \$(docker volume ls -q --filter label=$MANAGED) 2>/dev/null || true"
  sh_ "docker volume ls --format '{{.Name}}' | grep -E '^otterdeploy' | xargs -r -n1 docker volume rm 2>/dev/null || true"
else step "Keeping volumes (--keep-volumes)"; fi

# ── 5. images ─────────────────────────────────────────────────────────────────
step "Removing otterdeploy images"
sh_ "docker images --format '{{.Repository}}:{{.Tag}}' | grep -E 'ghcr.io/otterdeploy/' | xargs -r -n1 docker rmi -f 2>/dev/null || true"
sh_ "docker images -q --filter label=$MANAGED | xargs -r -n1 docker rmi -f 2>/dev/null || true"
if $BASE_IMAGES; then
  say "removing base images"
  run $SUDO docker rmi postgres:17-alpine redis:7-alpine 2>/dev/null || true
fi

# ── 6. ZFS pool ───────────────────────────────────────────────────────────────
if ! $KEEP_ZFS; then
  step "Destroying ZFS branching pool '$ZFS_POOL'"
  if command -v zpool >/dev/null 2>&1 && $SUDO zpool list "$ZFS_POOL" >/dev/null 2>&1; then
    run $SUDO zfs destroy -r "$ZFS_POOL/pg" 2>/dev/null || true
    run $SUDO zpool destroy -f "$ZFS_POOL" || true
  else say "(no '$ZFS_POOL' pool)"; fi
  [ -f "$DATA_DIR/branch-pool.img" ] && run $SUDO rm -f "$DATA_DIR/branch-pool.img" || true
else step "Keeping ZFS pool (--keep-zfs)"; fi

# ── 7. swarm ──────────────────────────────────────────────────────────────────
if ! $KEEP_SWARM; then
  step "Leaving Docker Swarm"
  $SUDO docker info 2>/dev/null | grep -q 'Swarm: active' && run $SUDO docker swarm leave --force || say "(not in a swarm)"
else step "Staying in Swarm (--keep-swarm)"; fi

# ── 8. data dirs ──────────────────────────────────────────────────────────────
if ! $KEEP_DATA; then
  step "Removing install + data directories"
  run $SUDO rm -rf "$DATA_DIR" "/opt/otterdeploy"
else step "Keeping data (--keep-data): $DATA_DIR"; fi

# ── 9. Docker ─────────────────────────────────────────────────────────────────
if ! $KEEP_DOCKER; then
  step "Removing Docker Engine"
  run $SUDO systemctl disable --now docker docker.socket 2>/dev/null || true
  if command -v apt-get >/dev/null 2>&1; then
    run $SUDO apt-get purge -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin 2>/dev/null || true
    run $SUDO apt-get autoremove -y 2>/dev/null || true
    run $SUDO rm -f /etc/apt/sources.list.d/docker.list /etc/apt/keyrings/docker.gpg
  elif command -v dnf >/dev/null 2>&1; then
    run $SUDO dnf remove -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin 2>/dev/null || true
    run $SUDO rm -f /etc/yum.repos.d/docker-ce.repo
  elif command -v pacman >/dev/null 2>&1; then
    run $SUDO pacman -Rns --noconfirm docker docker-compose 2>/dev/null || true
  fi
  run $SUDO rm -rf /var/lib/docker /var/lib/containerd /etc/docker
  say "Docker removed. Reboot recommended to clear leftover network interfaces."
else
  step "Keeping Docker (removing the installer's daemon.json tweak)"
  [ -f /etc/docker/daemon.json ] && run $SUDO rm -f /etc/docker/daemon.json || true
fi

step "Done — otterdeploy removed from this host."
