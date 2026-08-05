/**
 * The host paths a compose stack is allowed to bind-mount.
 *
 * Compose stacks are otherwise jailed to their own materialized directory:
 * `resolveBindSource` (./compose-materialize.ts) rewrites every bind source to
 * a path inside the stack tree, and a stack with no materialized tree at all
 * has its binds dropped. That default is deliberate and stays — a stack that
 * could name any host path could mount `/`, `/root/.ssh`, or another tenant's
 * data directory into a container it controls.
 *
 * This is the narrow exception: an explicit set of paths, matched exactly, that
 * a compose file may bind anyway. Everything not listed is still denied, and
 * extending the list is a code change that goes through review — a user cannot
 * grant themselves a new path by editing their compose file.
 *
 * READ THIS BEFORE ADDING AN ENTRY. There is no template provenance in the
 * system: nothing records which catalog template a stack came from (there is no
 * `templateId` column), so this list cannot distinguish "the Dozzle template we
 * ship" from "a compose file a user pasted". Every entry here is granted to
 * every compose stack on the install.
 */
import { normalize } from "node:path";

interface HostBindGrant {
  /** Forced onto the mount regardless of what the compose file asked for. */
  readOnly: boolean;
  /** Why this path is listed — shown in no UI, read by the next person here. */
  reason: string;
}

/**
 * `/var/run/docker.sock` is root-equivalent, and `readOnly` is weaker than it
 * looks: the Docker API is HTTP over that socket, and a read-only *file* mode
 * does not stop API calls that create privileged containers. It is a guard
 * against casual writes, not a security boundary. It is listed because the log
 * viewers in the catalog (Dozzle) cannot function without it and the alternative
 * was shipping a template that silently could never start.
 */
const HOST_BIND_ALLOWLIST = new Map<string, HostBindGrant>([
  [
    "/var/run/docker.sock",
    { readOnly: true, reason: "container log/stat viewers (Dozzle) read the daemon API" },
  ],
]);

export interface AllowedHostBind {
  source: string;
  readOnly: boolean;
}

/**
 * The grant for a compose bind `source`, or null when the path is not listed
 * and the caller should fall back to jailing it inside the stack directory.
 *
 * Matched on the normalized path so `/var/run//docker.sock` and
 * `/var/run/./docker.sock` cannot slip past by spelling. Relative sources are
 * never host binds — they belong to the stack tree — so they never match.
 */
export function allowedHostBind(source: string): AllowedHostBind | null {
  if (!source.startsWith("/")) return null;
  const path = normalize(source);
  const grant = HOST_BIND_ALLOWLIST.get(path);
  if (!grant) return null;
  return { source: path, readOnly: grant.readOnly };
}

/** Listed paths, for the parse-time warning that names what IS permitted. */
export function allowedHostBindPaths(): string[] {
  return [...HOST_BIND_ALLOWLIST.keys()];
}
