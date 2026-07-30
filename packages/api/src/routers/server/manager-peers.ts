/**
 * Admit a joining node to the MANAGER's own nftables peer set, before it tries
 * to join the swarm.
 *
 * od-5j8.11 gates the manager's 2377/7946/4789 behind the `otterdeploy_peers`
 * set so swarm ports are never world-reachable. But provisioning only ever
 * applied a ruleset to the NEW node (provision-host-firewall.ts, over that
 * node's SSH session) — nothing re-applied the manager's. So the manager's
 * INPUT chain dropped the join before Docker could complete it, surfacing as
 * the daemon's "Timeout was reached before node joined".
 *
 * The address that must be admitted is the node's EGRESS address, which is not
 * necessarily the one we SSH to: a host with a floating or secondary IP accepts
 * SSH on one address while the default route sources outbound traffic from
 * another. We therefore ask the node which source it will use to reach the
 * manager (`ip route get`) instead of assuming `server.host` — admitting the
 * SSH address alone leaves the join dropped exactly as before.
 *
 * Runs on the host via runOnHost(), whose contract is that the script is fixed,
 * trusted text. Every interpolated address is passed through filterIpv4Peers
 * first, so only bare IPv4 literals (digits and dots) ever reach the shell.
 */

import type { SshSession } from "./ssh-exec";

import { runOnHost } from "../../system-health/host-run";
import { filterIpv4Peers, OTTERDEPLOY_NFT_TABLE, OTTERDEPLOY_PEER_SET } from "./host-firewall";

const RULESET_PATH = "/etc/nftables-otterdeploy.conf";

/** Ask the node which source address it will use to reach `managerIp`. Pure. */
export function egressProbeScript(managerIp: string): string {
  return `ip route get ${managerIp} 2>/dev/null | sed -n 's/.*[[:space:]]src[[:space:]]\\{1,\\}\\([0-9.]\\{1,\\}\\).*/\\1/p' | head -1`;
}

/**
 * Add `ips` to the manager's peer set and persist them, reverting the file if
 * the edit wouldn't parse. Returns "" when there is nothing safe to add. Pure
 * and exactly assertable — see manager-peers.test.ts.
 */
export function managerPeerScript(ips: readonly string[]): string {
  const safe = filterIpv4Peers(ips);
  if (safe.length === 0) return "";
  const set = `inet ${OTTERDEPLOY_NFT_TABLE} ${OTTERDEPLOY_PEER_SET}`;
  return [
    "set -e",
    // An install predating od-5j8.11 has no such set; adding to it would fail
    // the whole script, so treat its absence as "nothing to gate" and move on.
    `if ! nft list set ${set} >/dev/null 2>&1; then echo "peer-set-absent"; exit 0; fi`,
    // Idempotent: re-adding an existing element succeeds.
    `nft add element ${set} { ${safe.join(", ")} }`,
    `cp -f ${RULESET_PATH} ${RULESET_PATH}.bak 2>/dev/null || true`,
    `for ip in ${safe.join(" ")}; do`,
    //  `grep … && continue` would abort under `set -e` on the not-found path.
    `  if ! grep -qF "$ip" ${RULESET_PATH} 2>/dev/null; then`,
    `    sed -i "s/\\(elements = { [^}]*\\)}/\\1, $ip }/" ${RULESET_PATH}`,
    "  fi",
    "done",
    `if ! nft -c -f ${RULESET_PATH} >/dev/null 2>&1; then`,
    `  cp -f ${RULESET_PATH}.bak ${RULESET_PATH} 2>/dev/null || true`,
    '  echo "peer-persist-reverted"; exit 0',
    "fi",
    'echo "peer-set-updated"',
  ].join("\n");
}

/**
 * The node's egress address toward the manager, or null when it can't be
 * determined (no `ip`, unparseable output, non-IPv4 path). Null is a soft
 * failure: the caller falls back to the SSH address and narrates it.
 */
async function resolveNodeEgressIp(
  session: SshSession,
  managerAddr: string,
  onLine: (line: string) => void,
): Promise<string | null> {
  const managerIp = filterIpv4Peers([managerAddr])[0];
  if (!managerIp) return null;
  const res = await session.runScript(egressProbeScript(managerIp));
  if (res.exitCode !== 0) {
    onLine(`   · could not determine this host's egress address (exit ${res.exitCode})`);
    return null;
  }
  const found = filterIpv4Peers([res.output.trim()])[0];
  return found ?? null;
}

/**
 * Resolve the node's egress address and admit it to the manager's peer set.
 *
 * The whole pre-join step in one call, so the runner stays a straight line —
 * its branching budget is already spent on the provisioning flow itself.
 */
export async function admitNodeToManager(
  session: SshSession,
  opts: { managerAddr: string; sshHost: string },
  onLine: (line: string) => void,
): Promise<void> {
  const egressIp = await resolveNodeEgressIp(session, opts.managerAddr, onLine);
  if (egressIp && egressIp !== opts.sshHost) {
    onLine(`   · node reaches the manager from ${egressIp} (SSH address is ${opts.sshHost})`);
  }
  await allowPeersOnManager([egressIp ?? opts.sshHost], onLine);
}

/**
 * Best-effort: never fails the provision. A manager that can't be reconfigured
 * still lets the join proceed — it just fails later at the daemon, the same way
 * it did before this existed, and we say so rather than pretending it worked.
 */
async function allowPeersOnManager(
  ips: readonly string[],
  onLine: (line: string) => void,
): Promise<void> {
  const script = managerPeerScript(ips);
  if (!script) {
    onLine("   · no IPv4 address to admit — skipping manager firewall update");
    return;
  }
  onLine("── admitting node to the manager's swarm-port allowlist ──");
  const ran = await runOnHost(script);
  if (ran.isErr()) {
    onLine(`   · could not update the manager firewall: ${ran.error.message}`);
    onLine("   · the swarm join may time out until this host admits the node");
    return;
  }
  const out = ran.value.output.trim();
  if (ran.value.exitCode !== 0) {
    onLine(`   · manager firewall update failed (exit ${ran.value.exitCode}): ${out}`);
    return;
  }
  if (out.includes("peer-set-absent")) {
    onLine("   · manager has no otterdeploy peer set — nothing to admit");
    return;
  }
  if (out.includes("peer-persist-reverted")) {
    onLine("   · admitted for this boot, but the persisted ruleset was left unchanged");
    return;
  }
  onLine(`✓ manager admits ${filterIpv4Peers(ips).join(", ")} on the swarm ports`);
}
