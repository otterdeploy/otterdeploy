/**
 * Host-level nftables firewall — layer 1 of the VPS defense described in
 * docs/designs/vps-firewall-layering.md. Closes every inbound port except
 * what the platform needs: SSH, the Caddy edge (80/443), and — scoped to a
 * peer allowlist, never the world — the Docker Swarm control-plane ports
 * (2377 raft/mgmt, 7946 gossip, 4789 VXLAN overlay). Layer 2 (CrowdSec's
 * native nftables bouncer — see cscli.ts / provision-firewall.ts) adds
 * dynamic IP-reputation bans on top of this static baseline, in the SAME
 * table so `nft list ruleset` shows one coherent policy.
 *
 * Docker gotcha this exists to close: dockerd manipulates iptables/nftables
 * DIRECTLY for published container ports (DNAT into the FORWARD chain via
 * its own `DOCKER-USER` chain) — a naive INPUT-only ruleset (the classic
 * ufw+Docker footgun, documented by both Docker and CrowdSec) never sees
 * that traffic. Swarm's own control-plane ports, by contrast, ARE plain host
 * listeners (dockerd binds them itself on the host network namespace), so
 * INPUT-chain rules correctly gate them — no DOCKER-USER involvement needed
 * there. We additionally install one defense-in-depth rule in Docker's own
 * `DOCKER-USER` chain (created by dockerd, evaluated before Docker's
 * permissive forwarding rules — see Docker's own docs on DOCKER-USER) that
 * drops new forwarded connections to anything but 80/443, so an operator's
 * accidental `-p hostport:containerport` publish can't bypass this policy —
 * this platform's ingress contract is "everything public goes through
 * Caddy."
 *
 * Lockout safety: `ct state established,related accept` is evaluated before
 * any port rule, so the SSH session the installer/provisioner is already
 * running over survives even if the rendered ruleset is wrong — only NEW
 * connections would be refused. The current sshd port is ALWAYS included
 * from the caller-supplied probe (never hardcoded to 22), and the whole
 * ruleset lives in one named table (`inet otterdeploy`) that a single
 * `nft delete table inet otterdeploy` atomically removes — the documented
 * rollback (see docs/designs/vps-firewall-layering.md §Recovery and
 * scripts/install.sh's `firewall-rollback` subcommand).
 */

export const OTTERDEPLOY_NFT_TABLE = "otterdeploy";
export const OTTERDEPLOY_PEER_SET = "otterdeploy_peers";
/** Swarm manager/raft (tcp) + gossip (tcp+udp). */
export const SWARM_TCP_PORTS = [2377, 7946] as const;
/** Gossip (udp) + VXLAN overlay data plane (udp). */
export const SWARM_UDP_PORTS = [7946, 4789] as const;
/** The only two ports the platform's own ingress contract publishes. */
export const EDGE_TCP_PORTS = [80, 443] as const;

export interface HostFirewallOptions {
  /** Current sshd port — ALWAYS included in the allow-list; never omitted
   *  even when it's the conventional 22 (an explicit rule beats an assumed
   *  default). */
  sshPort: number;
  /** Other swarm member addresses (bare IPv4, no CIDR/port) allowed to reach
   *  the swarm control-plane ports. Empty on a single-node install — the set
   *  is declared but starts empty, which is the safe default (nothing but
   *  this host can reach ports it doesn't need yet). */
  peerIpsV4: string[];
}

function dedupe(values: readonly (string | number)[]): string[] {
  return [...new Set(values.map(String))];
}

/**
 * The swarm control-plane peer set only takes bare IPv4 literals (an
 * nftables `ipv4_addr` set can't hold a hostname). Given a list of
 * candidate addresses (server rows' `host`/`meshAddress` fields — which may
 * be domain names, IPv6, or "<ip>:port"), keep only the ones that are
 * literal IPv4 addresses, stripping an optional port. Fail-closed-on-typo:
 * anything that doesn't parse is silently dropped rather than guessed at
 * (same posture as trusted-proxy.ts's parseTrustedProxies) — a dropped peer
 * just means that node won't reach this one's swarm ports until remediation
 * re-resolves it, never a broadened allowlist.
 */
export function filterIpv4Peers(candidates: readonly (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const raw of candidates) {
    if (!raw) continue;
    const bare = raw.includes(":") ? raw.split(":")[0] : raw;
    if (bare && /^(\d{1,3}\.){3}\d{1,3}$/.test(bare)) out.push(bare);
  }
  return dedupe(out);
}

/**
 * The declarative nftables ruleset (a `table inet otterdeploy { … }` block),
 * suitable for `nft -f`. Pure and exactly assertable — see
 * packages/api/src/__tests__/security/od-5j8.11-*.test.ts.
 */
export function renderNftablesRuleset(opts: HostFirewallOptions): string {
  const peers = dedupe(opts.peerIpsV4);
  const swarmTcp = dedupe(SWARM_TCP_PORTS).join(", ");
  const swarmUdp = dedupe(SWARM_UDP_PORTS).join(", ");
  const edgeTcp = dedupe(EDGE_TCP_PORTS).join(", ");
  const peerSetBody =
    peers.length > 0
      ? `\t\ttype ipv4_addr\n\t\telements = { ${peers.join(", ")} }`
      : "\t\ttype ipv4_addr";
  return [
    `table inet ${OTTERDEPLOY_NFT_TABLE} {`,
    `\tset ${OTTERDEPLOY_PEER_SET} {`,
    peerSetBody,
    "\t}",
    "",
    "\tchain input {",
    "\t\ttype filter hook input priority filter; policy drop;",
    '\t\tiif "lo" accept',
    "\t\tct state invalid drop",
    "\t\tct state established,related accept",
    "\t\ticmp type { echo-request, destination-unreachable, time-exceeded } accept",
    "\t\ticmpv6 type { echo-request, nd-neighbor-solicit, nd-neighbor-advert, destination-unreachable, time-exceeded } accept",
    `\t\ttcp dport ${opts.sshPort} accept`,
    `\t\ttcp dport { ${edgeTcp} } accept`,
    `\t\ttcp dport { ${swarmTcp} } ip saddr @${OTTERDEPLOY_PEER_SET} accept`,
    `\t\tudp dport { ${swarmUdp} } ip saddr @${OTTERDEPLOY_PEER_SET} accept`,
    "\t}",
    "}",
  ].join("\n");
}

/** Comment tag on the DOCKER-USER guard rule — how we find-and-replace it on
 *  a re-run instead of stacking duplicate rules. */
export const DOCKER_USER_GUARD_COMMENT = "otterdeploy-guard";

/**
 * Defense-in-depth: drop any NEW forwarded (i.e. Docker-published-port)
 * connection to a port other than 80/443, in Docker's own `DOCKER-USER`
 * chain — the one place rules are guaranteed to run before Docker's own
 * permissive ACCEPT. Scoped to `ip filter` (Docker only ever creates
 * DOCKER-USER in the IPv4 `filter` table), so it does NOT reference the
 * `inet otterdeploy` peer set (cross-table set references aren't valid
 * nftables).
 *
 * `ct status dnat` is load-bearing. DOCKER-USER hangs off the *forward* hook,
 * which carries container EGRESS as well as inbound published-port traffic, so
 * an unqualified match dropped every outbound connection a container made to
 * anything but 80/443/3000 — including the control plane's own `ssh` to a host
 * it was provisioning. That surfaced as "SSH connection timed out" on a box
 * whose port 22 was wide open, because the drop happened on the way out, not
 * on the way in. Inbound published-port traffic is DNAT'd and matches; egress
 * is SNAT'd and does not.
 *
 * Note the port compared here is the POST-DNAT one — the container's own port,
 * not the published host port — since DNAT runs in prerouting, before forward.
 */
export function dockerUserGuardScript(sudo = ""): string {
  const S = sudo ? `${sudo} ` : "";
  return [
    `if ${S}nft list chain ip filter DOCKER-USER >/dev/null 2>&1; then`,
    `  ${S}nft -a list chain ip filter DOCKER-USER 2>/dev/null | awk '/${DOCKER_USER_GUARD_COMMENT}/{print $NF}' | while read -r h; do ${S}nft delete rule ip filter DOCKER-USER handle "$h"; done`,
    `  ${S}nft insert rule ip filter DOCKER-USER ct status dnat tcp dport != { ${dedupe(EDGE_TCP_PORTS).join(", ")} } ct state new counter drop comment "${DOCKER_USER_GUARD_COMMENT}"`,
    '  echo "DOCKER-USER guard installed"',
    "else",
    '  echo "DOCKER-USER chain not present yet (Docker not started?) — guard skipped, re-run after Docker is up"',
    "fi",
  ].join("\n");
}

const RULESET_PATH = "/etc/nftables-otterdeploy.conf";
const MARKER_PATH = "/etc/otterdeploy/firewall-applied";

/**
 * The full idempotent install script: install nftables if missing, write +
 * validate + load the ruleset, persist it across reboots (an `include` line
 * in /etc/nftables.conf), install the DOCKER-USER guard, and drop a marker
 * file the status probe reads. Best-effort by design (mirrors
 * firewallBouncerInstallScript in cscli.ts) — a failure here must never fail
 * an otherwise-successful provision; the caller narrates and continues.
 *
 * Skips cleanly (exit 0, narrated) when another firewall manager (ufw/
 * firewalld) is already active — we never fight an operator's existing
 * choice; see docs/designs/vps-firewall-layering.md §Coexistence.
 */
export function hostFirewallInstallScript(opts: HostFirewallOptions, sudo: string): string {
  const S = sudo ? `${sudo} ` : "";
  const ruleset = renderNftablesRuleset(opts);
  return [
    "set -uo pipefail",
    // Coexistence: don't fight an already-active operator firewall.
    "if command -v ufw >/dev/null 2>&1 && " +
      `${S}ufw status 2>/dev/null | grep -qi 'Status: active'; then`,
    '  echo "ufw is active — leaving it in place; otterdeploy will not install nftables alongside it. Allow 80/443 (and this SSH port) manually: sudo ufw allow 80,443/tcp"',
    "  exit 0",
    "fi",
    "if command -v firewall-cmd >/dev/null 2>&1 && " +
      `${S}firewall-cmd --state 2>/dev/null | grep -q running; then`,
    '  echo "firewalld is active — leaving it in place; otterdeploy will not install nftables alongside it."',
    "  exit 0",
    "fi",
    "if ! command -v nft >/dev/null 2>&1; then",
    "  if command -v apt-get >/dev/null 2>&1; then " +
      `${S}apt-get update -y >/dev/null 2>&1; ${S}apt-get install -y nftables;`,
    `  elif command -v dnf >/dev/null 2>&1; then ${S}dnf install -y nftables;`,
    `  elif command -v yum >/dev/null 2>&1; then ${S}yum install -y nftables;`,
    `  elif command -v pacman >/dev/null 2>&1; then ${S}pacman -Sy --noconfirm nftables;`,
    `  elif command -v zypper >/dev/null 2>&1; then ${S}zypper install -y nftables;`,
    "  else",
    '    echo "no supported package manager found to install nftables — install it manually and re-run"',
    "    exit 90",
    "  fi",
    "fi",
    "if ! command -v nft >/dev/null 2>&1; then",
    '  echo "nftables install failed — host firewall not applied"',
    "  exit 91",
    "fi",
    `${S}mkdir -p /etc/otterdeploy`,
    `${S}tee ${RULESET_PATH} >/dev/null <<'OTTERDEPLOY_NFT_EOF'`,
    ruleset,
    "OTTERDEPLOY_NFT_EOF",
    // Syntax-check before touching the live ruleset — a bad file must never
    // half-apply and risk an inconsistent policy.
    `if ! ${S}nft -c -f ${RULESET_PATH}; then`,
    '  echo "generated nftables ruleset failed validation — NOT applied (see output above)"',
    "  exit 92",
    "fi",
    // Persist across reboots via an include, without clobbering any existing
    // /etc/nftables.conf content.
    "if [ -f /etc/nftables.conf ]; then",
    `  grep -qxF 'include "${RULESET_PATH}"' /etc/nftables.conf || ${S}sh -c "echo 'include \\"${RULESET_PATH}\\"' >> /etc/nftables.conf"`,
    "else",
    `  ${S}sh -c 'printf "#!/usr/sbin/nft -f\\ninclude \\"${RULESET_PATH}\\"\\n" > /etc/nftables.conf'`,
    "fi",
    `${S}systemctl enable nftables 2>/dev/null || true`,
    `${S}nft -f ${RULESET_PATH}`,
    dockerUserGuardScript(sudo),
    `${S}sh -c 'date -u +%FT%TZ > ${MARKER_PATH}'`,
    'echo "OTTER_FW_STATUS=applied"',
  ].join("\n");
}

/** Probe script for an already-provisioned node: is the otterdeploy table
 *  loaded, and is the native CrowdSec firewall bouncer active? Mirrors the
 *  `OTTER_<KEY>=` marker convention `probeScript()` (provision.ts) uses. */
export function hostFirewallStatusScript(sudo: string): string {
  const S = sudo ? `${sudo} ` : "";
  return [
    "set +e",
    `if command -v nft >/dev/null 2>&1 && ${S}nft list table inet ${OTTERDEPLOY_NFT_TABLE} >/dev/null 2>&1; then`,
    '  echo "OTTER_FW_TABLE=present"',
    "else",
    '  echo "OTTER_FW_TABLE=absent"',
    "fi",
    `if ${S}systemctl is-active crowdsec-firewall-bouncer >/dev/null 2>&1; then`,
    '  echo "OTTER_FW_BOUNCER=active"',
    "else",
    '  echo "OTTER_FW_BOUNCER=inactive"',
    "fi",
  ].join("\n");
}

export interface HostFirewallStatus {
  tablePresent: boolean;
  bouncerActive: boolean;
}

export function parseHostFirewallStatus(output: string): HostFirewallStatus {
  return {
    tablePresent: /^OTTER_FW_TABLE=present$/m.test(output),
    bouncerActive: /^OTTER_FW_BOUNCER=active$/m.test(output),
  };
}

/** Persisted classification of a server row's firewall provisioning state —
 *  see the `server_firewall_status` enum (packages/db/src/schema/server.ts).
 *  `unknown` covers both legacy rows created before this feature shipped AND
 *  rows where the step never ran (e.g. an older provision run) — both are
 *  drift: the node isn't known to be protected. */
export type FirewallStatusValue = "unknown" | "applied" | "failed" | "unsupported";

export interface FirewallDriftInput {
  firewallStatus: FirewallStatusValue;
  firewallBouncerActive: boolean;
}

/**
 * True when a server row is NOT known to be running the platform's firewall
 * baseline — i.e. it should be flagged for remediation. `unsupported` (no
 * nftables support / an operator's own ufw/firewalld already active) is NOT
 * drift by itself — it's an explicit, narrated decision — but still counts
 * as drift if the bouncer is also inactive, since that means NEITHER layer
 * is protecting the node.
 */
export function isFirewallDrifted(row: FirewallDriftInput): boolean {
  if (row.firewallStatus === "applied" && row.firewallBouncerActive) return false;
  if (row.firewallStatus === "unsupported" && row.firewallBouncerActive) return false;
  return true;
}
