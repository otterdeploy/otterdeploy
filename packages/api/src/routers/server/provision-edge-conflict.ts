/**
 * Should we install a node edge proxy on this host, and if not, why not.
 *
 * `installNodeProxy` binds 80, 443 and 443/udp. On a box already running
 * Coolify, Dokploy or CapRover, that platform's proxy holds them, so the
 * `docker run` fails with "port is already allocated". Nothing checked: the
 * install is best-effort by design, so it emitted one warning line and
 * returned, the join succeeded, and the server was marked `ready`.
 *
 * The result was the worst kind of green: a node that looks healthy, has no
 * working edge, and says so only in a provision log that scrolls past once.
 * Pin a service there and it is unreachable, with the DNS gap (od-rsc8)
 * ensuring nothing explains why either.
 *
 * So the decision is made BEFORE the attempt, from the probe, and it is
 * recorded on the server row rather than narrated and forgotten. That shape is
 * borrowed from `firewallStatus`, which already distinguishes "we did it" from
 * "something else was already there" ("unsupported") rather than calling the
 * second a failure. A box someone deliberately runs Coolify on is not broken.
 *
 * PURE, so the interesting part is testable without a host.
 */

import type { DetectedPlatform } from "../migrate/coolify";
import type { EdgePortHolder } from "./provision-probe";

/** What we decided, and what to record. */
export type EdgeProxyDecision =
  | { install: true }
  | { install: false; status: "port_conflict" | "platform_present"; reason: string };

function describeHolders(holders: readonly EdgePortHolder[]): string {
  return holders
    .map((h) => (h.holder === "unknown" ? `${h.port}` : `${h.port} (${h.holder})`))
    .join(" and ");
}

/**
 * Decide from the probe.
 *
 * Port conflict is checked FIRST and reported as the reason, even when a
 * platform was also detected. The port is the thing that actually stops the
 * install, it names the specific container to deal with, and it stays correct
 * when the holder is something we have no detector for. "Coolify is installed"
 * would be a less precise answer to the same question.
 *
 * A detected platform with the ports free is still a refusal, but a different
 * one: the platform's proxy may simply be stopped right now, and racing it back
 * up for :443 is not something to do silently on a machine someone else's
 * workloads are running on.
 */
export function decideEdgeProxy(input: {
  edgePortHolders: readonly EdgePortHolder[];
  platforms: readonly DetectedPlatform[];
}): EdgeProxyDecision {
  if (input.edgePortHolders.length > 0) {
    return {
      install: false,
      status: "port_conflict",
      reason:
        `Port ${describeHolders(input.edgePortHolders)} is already in use on this host, so ` +
        `otterdeploy's edge proxy was not installed. The node joined and can run workloads, but ` +
        `it cannot terminate traffic itself: services placed here are only reachable while the ` +
        `control-plane edge is up. Free the port and re-run provisioning to install it.`,
    };
  }

  if (input.platforms.length > 0) {
    const names = input.platforms.map((p) => p.platform).join(", ");
    return {
      install: false,
      status: "platform_present",
      reason:
        `This host is already running ${names}, so otterdeploy's edge proxy was not installed. ` +
        `Its proxy is not holding 80/443 right now, but starting ours would take those ports ` +
        `from it the moment it restarts. Migrate or remove ${names} first, then re-run ` +
        `provisioning.`,
    };
  }

  return { install: true };
}
