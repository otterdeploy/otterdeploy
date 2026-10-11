/**
 * Whether a service's new version may start beside the running one on the
 * plain-Docker runtime (docker-rollout.ts: blue-green), or must replace it
 * (swap). Pure: reads only the spec.
 */
import type { SpecMount } from "../swarm/file-mounts";
import type { ContainerSpec } from "./types";

import { PLATFORM } from "../constants";

/** Does the service bind a port on the host (tcp app-protocol ports, see
 *  buildContainerOptions)? Two containers cannot hold the same host port, so
 *  such a service cannot run old and new side by side. */
function publishesHostPort(spec: ContainerSpec): boolean {
  return spec.ports.some((p) => p.appProtocol === "tcp");
}

/**
 * Why a new version cannot start beside the running one, or null when it can
 * (docker-rollout.ts swaps instead of blue-green). A host port can be bound
 * once; a writable volume or bind must not have two copies of the app writing
 * it at once (gitea's second copy exits on its LevelDB lock, so every
 * redeploy failed). Read-only mounts are shared safely, and so are the
 * config files the platform writes from the service's own rows: each deploy
 * rewrites them, they hold no state of the app's.
 */
export function exclusiveRollout(spec: ContainerSpec): string | null {
  if (publishesHostPort(spec)) return "the service publishes a host port";
  const shared = spec.mounts.find(keepsState);
  return shared ? `the service writes to ${shared.Target} (a ${shared.Type} it keeps)` : null;
}

/** A mount the app can write state to (not read-only, not a platform-written file). */
export function keepsState(mount: SpecMount): boolean {
  if (mount.ReadOnly) return false;
  const fileRoot = `${PLATFORM.files.root}/`;
  return !(mount.Type === "bind" && mount.Source.startsWith(fileRoot));
}
