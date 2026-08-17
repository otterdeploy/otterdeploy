/**
 * Applies the host-level nftables baseline (host-firewall.ts) to a freshly
 * provisioned node over SSH, and probes the result. Runs alongside
 * `installNodeFirewallBouncer` (provision-firewall.ts): together they're the
 * two per-node steps that give "every node, not just the primary" its
 * meaning: install.sh only ever touches the primary host, this is what
 * extends the same policy to nodes added afterward.
 *
 * Best-effort by design, matching the rest of the provisioning pipeline: a
 * firewall failure must never fail an otherwise-successful node join. The
 * caller (provision-runner.ts) records the outcome on the server row so it
 * shows up as drift instead of silently vanishing.
 */
import type { Privilege } from "./provision";
import type { SshSession } from "./ssh-exec";

import {
  type HostFirewallStatus,
  hostFirewallInstallScript,
  hostFirewallStatusScript,
  parseHostFirewallStatus,
} from "./host-firewall";

export interface HostFirewallTarget {
  sshPort: number;
  /** Other known swarm member addresses this node should accept swarm
   *  control-plane traffic from. */
  peerIpsV4: string[];
  privilege: Privilege;
}

export type HostFirewallOutcome =
  | { status: "applied"; probe: HostFirewallStatus }
  | { status: "unsupported"; reason: string }
  | { status: "failed"; reason: string };

/**
 * Full best-effort flow: install + apply the ruleset, then probe it back.
 * Narrates every step; never throws (mirrors installNodeFirewallBouncer).
 */
export async function installHostFirewall(
  session: SshSession,
  target: HostFirewallTarget,
  onLine: (line: string) => void,
): Promise<HostFirewallOutcome> {
  if (target.privilege === "none") {
    return { status: "failed", reason: "no root/sudo privilege on this host" };
  }
  onLine("── applying host firewall (nftables baseline) ──");
  const sudo = target.privilege === "sudo" ? "sudo" : "";
  const script = hostFirewallInstallScript(
    { sshPort: target.sshPort, peerIpsV4: target.peerIpsV4 },
    sudo,
  );
  const res = await session.runScript(script, onLine);
  // Exit 90/91/92 are narrated, non-fatal outcomes the script itself prints
  // a reason for (no package manager / install failed / bad ruleset).
  if (res.exitCode === 90 || res.exitCode === 91 || res.exitCode === 92) {
    return { status: "failed", reason: `install script exited ${res.exitCode}` };
  }
  if (res.exitCode !== 0) {
    onLine(
      "⚠ host firewall install failed. The node joined fine, but this host's own inbound ports are not locked down by otterdeploy. Check the output above and re-run remediation.",
    );
    return { status: "failed", reason: `exit ${res.exitCode}` };
  }
  // ufw/firewalld coexistence exits 0 with no table applied. The script
  // narrates it; the probe below tells us which happened.
  const probeRes = await session.runScript(hostFirewallStatusScript(sudo), onLine);
  const probe = parseHostFirewallStatus(probeRes.output);
  if (!probe.tablePresent) {
    onLine("host firewall not applied by otterdeploy (an existing ufw/firewalld took precedence)");
    return { status: "unsupported", reason: "another firewall manager is active" };
  }
  onLine("✓ host firewall applied (nftables table 'otterdeploy' loaded)");
  return { status: "applied", probe };
}
