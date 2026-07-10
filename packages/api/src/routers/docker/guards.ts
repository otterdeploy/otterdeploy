/**
 * Pure refusal guards for destructive docker-raw operations. Kept free of the
 * docker client so they unit-test like firewall/decision.ts — the service
 * layer gathers the facts (usage counts, attachment lists, network flags) and
 * these decide yes/no with an operator-readable reason.
 */

export type GuardResult = { ok: true } | { ok: false; reason: string };

/**
 * Image removal: refuse while containers (running OR stopped) still reference
 * the image, unless the caller passed `force`. Even with force the daemon
 * itself still rejects images backing a *running* container — force only
 * covers stopped references and multi-tag untagging.
 */
export function guardImageRemoval(opts: { inUseBy: number; force: boolean }): GuardResult {
  if (opts.inUseBy > 0 && !opts.force) {
    return {
      ok: false,
      reason: `Image is referenced by ${opts.inUseBy} container${opts.inUseBy === 1 ? "" : "s"}. Remove them first, or force-remove to untag anyway.`,
    };
  }
  return { ok: true };
}

/**
 * Volume removal: never removable while any container (running or stopped)
 * mounts it — there is no safe force path; a forced remove of an attached
 * volume is data loss with extra steps.
 */
export function guardVolumeRemoval(opts: { attachedTo: string[] }): GuardResult {
  if (opts.attachedTo.length > 0) {
    const shown = opts.attachedTo.slice(0, 3).join(", ");
    const more = opts.attachedTo.length > 3 ? ` +${opts.attachedTo.length - 3} more` : "";
    return {
      ok: false,
      reason: `Volume is mounted by ${shown}${more}. Remove those containers first.`,
    };
  }
  return { ok: true };
}

/** Docker's own plumbing networks — deleting these breaks the daemon/swarm. */
export const BUILTIN_NETWORKS = new Set(["bridge", "host", "none", "ingress", "docker_gwbridge"]);

/**
 * Network removal: refuse the daemon's builtin networks (bridge/host/none),
 * swarm plumbing (ingress/docker_gwbridge or any network with the Ingress
 * flag), and any network with containers still attached.
 */
export function guardNetworkRemoval(opts: {
  name: string;
  ingress: boolean;
  attached: number;
}): GuardResult {
  if (BUILTIN_NETWORKS.has(opts.name) || opts.ingress) {
    return {
      ok: false,
      reason: `"${opts.name}" is a builtin Docker network and can't be removed.`,
    };
  }
  if (opts.attached > 0) {
    return {
      ok: false,
      reason: `Network has ${opts.attached} container${opts.attached === 1 ? "" : "s"} attached. Disconnect them first.`,
    };
  }
  return { ok: true };
}
