/**
 * The edge-proxy step of provisioning: decide, install, record.
 *
 * One step, three parts that have to stay together. Deciding without recording
 * is what the bug was — `installNodeProxy` is best-effort by design, so a host
 * whose ports were taken emitted a single warning line, the join reported
 * `ready`, and the operator was left with a healthy-looking node that could not
 * serve traffic (od-u05r).
 *
 * Split out of provision-runner because the runner's job function was already
 * at its size cap; putting it back inline is what would push it over again.
 */

import type { OrganizationId, ServerId } from "@otterdeploy/shared/id";

import { env } from "@otterdeploy/env/server";

import type { ProbeResult } from "./provision-probe";
import type { SshSession } from "./ssh-exec";

import { matchPlatforms } from "../migrate/coolify";
import { parseRemoteContainers } from "../migrate/detect-remote";
import { decideEdgeProxy } from "./provision-edge-conflict";
import { installNodeProxy } from "./provision-node-proxy";
import { patchServerEdgeProxy } from "./queries-edge-proxy";

export async function runEdgeProxyStep(input: {
  session: SshSession;
  probe: ProbeResult;
  serverId: ServerId;
  organizationId: OrganizationId;
  emit: (line: string) => void;
}): Promise<void> {
  const { session, probe, serverId, organizationId, emit } = input;

  // The platform match reuses the migrate detector's rules rather than
  // restating them, so provisioning and the migration page can never disagree
  // about what Coolify looks like.
  const decision = decideEdgeProxy({
    edgePortHolders: probe.edgePortHolders,
    platforms: matchPlatforms(parseRemoteContainers(probe.containerList)),
  });

  if (!decision.install) {
    emit(`⚠ ${decision.reason}`);
    await patchServerEdgeProxy({
      serverId,
      organizationId,
      edgeProxyStatus: decision.status,
      edgeProxyError: decision.reason,
    });
    return;
  }

  const installed = await installNodeProxy(
    session,
    {
      privilege: probe.privilege,
      image: `${env.OTTERDEPLOY_REGISTRY}/caddy:${env.OTTERDEPLOY_VERSION}`,
    },
    emit,
  );
  await patchServerEdgeProxy({
    serverId,
    organizationId,
    edgeProxyStatus: installed.status,
    edgeProxyError: installed.reason,
  });
}
