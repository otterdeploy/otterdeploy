/**
 * od-5j8.11 drift remediation: split out of provision-runner.ts to keep that
 * file under the line cap. Re-applies ONLY the host-firewall + native-bouncer
 * steps to an already-joined node, without touching Docker install / swarm
 * join / provisionStatus. Triggered by `server.reapplyFirewall`
 * (handlers.ts) via the same `server.provision` job in `firewallOnly` mode.
 */
import type { ProvisionServerPayload } from "@otterdeploy/jobs";
import type { OrganizationId, ServerId, SshKeyId } from "@otterdeploy/shared/id";

import { decryptForDomain } from "../../lib/crypto";
import { getSshKeyInOrg } from "../sshKeys/queries";
import { filterIpv4Peers } from "./host-firewall";
import { getSwarmJoinTokens } from "./join-tokens";
import { parseProbe, probeScript } from "./provision";
import { installNodeFirewallBouncer, managerHostOf } from "./provision-firewall";
import { installHostFirewall } from "./provision-host-firewall";
import { emitProvisionLine, endProvisionStream } from "./provision-stream";
import { listServersByOrg, patchServerFirewall } from "./queries";
import { SshSession } from "./ssh-exec";

/**
 * Other org servers' IPv4 addresses (mesh address preferred, else host),
 * excluding `excludeHost`: the peer set a newly (re)configured node's
 * swarm-port rules should trust. Best-effort/read-only; never throws (a DB
 * hiccup here degrades to "no peers yet", not a failed provision).
 */
export async function resolveFirewallPeers(
  organizationId: OrganizationId,
  excludeHost: string,
): Promise<string[]> {
  const rows = await listServersByOrg(organizationId);
  return filterIpv4Peers(
    rows.filter((r) => r.host !== excludeHost).map((r) => r.meshAddress ?? r.host),
  );
}

/** Resolve the swarm manager address from OUR daemon. Same lookup
 *  provision-runner.ts's resolveJoinTarget does, duplicated narrowly here
 *  (firewallOnly never joins, so it only needs the address, not a token). */
async function resolveManagerAddr(): Promise<string> {
  const tokens = await getSwarmJoinTokens();
  if (tokens.managerAddr === "–") {
    throw new Error("The primary host isn't a Docker Swarm manager yet.");
  }
  return tokens.managerAddr;
}

/**
 * od-5j8.11 drift remediation: connect to an ALREADY-JOINED node and re-run
 * only the host-firewall + native-bouncer steps. Never touches
 * provisionStatus/status: a firewall remediation run must not resurrect a
 * failed/removed node's lifecycle state. sshKeyId-only (no password path: a
 * one-time bootstrap password is never stored, so there's nothing left to
 * reconnect with after the initial join: same constraint retryProvision
 * enforces).
 */
export async function runFirewallOnlyJob(payload: ProvisionServerPayload): Promise<void> {
  const serverId = payload.serverId as ServerId;
  const organizationId = payload.organizationId as OrganizationId;
  const emit = (line: string) => emitProvisionLine(serverId, line);
  try {
    if (!payload.sshKeyId) {
      throw new Error("No stored SSH key on this server, remediation requires a managed key.");
    }
    const managerAddr = await resolveManagerAddr();
    const key = await getSshKeyInOrg({ id: payload.sshKeyId as SshKeyId, organizationId });
    if (!key?.privateKeyCiphertext) {
      throw new Error("The stored SSH key has no private half. Pick a generated key.");
    }
    const privateKey = await decryptForDomain(key.privateKeyCiphertext, "ssh-keys");

    emit(`── connecting to ${payload.host}:${payload.sshPort} as ${payload.sshUser} ──`);
    const session = await SshSession.connect({
      host: payload.host,
      port: payload.sshPort,
      user: payload.sshUser,
      privateKey,
    });
    try {
      const probe = parseProbe((await session.runScript(probeScript(), emit)).output);
      if (probe.privilege === "none") {
        throw new Error("the SSH user is neither root nor has passwordless sudo.");
      }
      await installNodeFirewallBouncer(
        session,
        { nodeHost: payload.host, managerAddr, privilege: probe.privilege },
        emit,
      );
      const peers = await resolveFirewallPeers(organizationId, payload.host);
      peers.push(managerHostOf(managerAddr));
      const outcome = await installHostFirewall(
        session,
        { sshPort: payload.sshPort, peerIpsV4: filterIpv4Peers(peers), privilege: probe.privilege },
        emit,
      );
      await patchServerFirewall({
        serverId,
        organizationId,
        firewallStatus: outcome.status,
        firewallError: outcome.status === "applied" ? null : outcome.reason,
        firewallBouncerActive: outcome.status === "applied" && outcome.probe.bouncerActive,
      });
      emit(
        outcome.status === "applied"
          ? "✓ firewall remediation complete"
          : `✗ firewall remediation: ${outcome.status}`,
      );
    } finally {
      session.dispose();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit(`✗ firewall remediation failed: ${message}`);
    await patchServerFirewall({
      serverId,
      organizationId,
      firewallStatus: "failed",
      firewallError: message,
      firewallBouncerActive: false,
    }).catch(() => undefined);
  } finally {
    endProvisionStream(serverId);
  }
}
