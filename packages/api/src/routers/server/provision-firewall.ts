/**
 * CrowdSec firewall bouncer for freshly-provisioned nodes. The manager's
 * nftables bouncer only protects the manager — direct traffic to an added
 * node (its SSH, published ports) is unfiltered unless the node runs its own
 * bouncer against the manager's LAPI. This registers a per-node API key on
 * the agent (revocable independently), installs the deb (packagecloud, noble
 * pinned — no dist for newer Ubuntus yet), writes the config, and starts the
 * systemd service. Best-effort by design: a bouncer failure must never fail
 * an otherwise-joined node.
 *
 * Reachability caveat the operator owns: LAPI binds to the host loopback by
 * default — multi-node installs must set CROWDSEC_LAPI_BIND to the manager
 * address the nodes dial (the swarm manager/mesh IP). The install script
 * probes /health and says so when it can't connect.
 */
import type { Privilege } from "./provision";
import type { SshSession } from "./ssh-exec";

import { cscliRun } from "../firewall/cscli";

export interface NodeBouncerTarget {
  /** Host the operator typed — used (sanitized) as the bouncer name. */
  nodeHost: string;
  /** "<ip>:2377" swarm join target; the LAPI is assumed on the same address. */
  managerAddr: string;
  privilege: Privilege;
}

const bouncerName = (host: string) => `firewall-${host.replace(/[^a-zA-Z0-9._-]/g, "-")}`;

/** "<ip>:2377" / "[v6]:2377" → the bare address the node dials. */
export function managerHostOf(managerAddr: string): string {
  if (managerAddr.startsWith("[")) return managerAddr.slice(0, managerAddr.indexOf("]") + 1);
  return managerAddr.split(":")[0] ?? managerAddr;
}

/** Register (or re-register) the node's own LAPI key. Null ⇒ agent down. */
async function registerNodeBouncer(name: string): Promise<string | null> {
  // Re-provision safe: drop a stale registration, then mint fresh.
  await cscliRun('cscli bouncers delete "$1" >/dev/null 2>&1 || true', [name]);
  const out = await cscliRun('cscli bouncers add "$1" -o raw', [name]);
  if (out === null) return null;
  if (/error|failed|already exists/i.test(out)) return null;
  // `-o raw` prints exactly the key; keep the last non-empty line defensively.
  const key = out
    .trim()
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .at(-1)
    ?.trim();
  return key && key.length >= 16 ? key : null;
}

/** Exit code the script uses for "not an apt distro" (narrated, non-fatal). */
export const UNSUPPORTED_DISTRO_EXIT = 90;

/** The remote install script. Values are control-plane-generated (hex key,
 *  ip-derived URL), embedded via a quoted heredoc so the shell never expands
 *  them. Exported for tests. */
export function firewallBouncerInstallScript(apiUrl: string, apiKey: string, sudo: string): string {
  return [
    "set -e",
    `S="${sudo}"`,
    `if ! command -v apt-get >/dev/null 2>&1; then echo "no apt on this host — install crowdsec-firewall-bouncer manually"; exit ${UNSUPPORTED_DISTRO_EXIT}; fi`,
    "if ! command -v crowdsec-firewall-bouncer >/dev/null 2>&1; then",
    "\t. /etc/os-release",
    // packagecloud publishes no dist for Ubuntu releases newer than noble —
    // pin it (packages are arch/libc-portable); other distros auto-detect.
    '\tif [ "$ID" = "ubuntu" ]; then PC_ENV="os=ubuntu dist=noble"; else PC_ENV=""; fi',
    "\tcurl -s https://packagecloud.io/install/repositories/crowdsec/crowdsec/script.deb.sh | $S env $PC_ENV bash",
    "\t$S apt-get install -y crowdsec-firewall-bouncer-nftables",
    "fi",
    "$S mkdir -p /etc/crowdsec/bouncers",
    "$S tee /etc/crowdsec/bouncers/crowdsec-firewall-bouncer.yaml >/dev/null <<'OTTERDEPLOY_EOF'",
    "mode: nftables",
    "update_frequency: 10s",
    "log_mode: file",
    "log_dir: /var/log/",
    "log_level: info",
    `api_url: ${apiUrl}`,
    `api_key: ${apiKey}`,
    "OTTERDEPLOY_EOF",
    "$S chmod 600 /etc/crowdsec/bouncers/crowdsec-firewall-bouncer.yaml",
    // Reachability probe — non-fatal, but the single most likely footgun.
    `if ! curl -s -m 5 -o /dev/null "${apiUrl.replace(/\/$/, "")}/health"; then echo "warning: LAPI ${apiUrl} not reachable from this node — set CROWDSEC_LAPI_BIND on the manager to an address this node can dial"; fi`,
    "$S systemctl enable --now crowdsec-firewall-bouncer",
    "$S systemctl is-active crowdsec-firewall-bouncer",
    'echo "firewall bouncer running"',
  ].join("\n");
}

/**
 * Full best-effort flow over an established SSH session: register key →
 * install → start → verify. Narrates every skip/failure; never throws.
 */
export async function installNodeFirewallBouncer(
  session: SshSession,
  target: NodeBouncerTarget,
  onLine: (line: string) => void,
): Promise<void> {
  if (target.privilege === "none") return;
  onLine("── installing CrowdSec firewall bouncer ──");
  const key = await registerNodeBouncer(bouncerName(target.nodeHost));
  if (!key) {
    onLine(
      "crowdsec agent isn't running on the primary — skipping the firewall bouncer (enable the firewall profile, then re-provision to add it).",
    );
    return;
  }
  const apiUrl = `http://${managerHostOf(target.managerAddr)}:8080/`;
  const sudo = target.privilege === "sudo" ? "sudo" : "";
  const res = await session.runScript(firewallBouncerInstallScript(apiUrl, key, sudo), onLine);
  if (res.exitCode === UNSUPPORTED_DISTRO_EXIT) return; // narrated by the script
  if (res.exitCode !== 0) {
    onLine(
      "⚠ firewall bouncer install failed — the node joined fine, and traffic entering through the manager edge is still filtered, but direct traffic to this node is not. Install crowdsec-firewall-bouncer manually or re-provision.",
    );
    return;
  }
  onLine(`✓ firewall bouncer active (LAPI ${apiUrl})`);
}
