/**
 * The host paths a compose stack is allowed to bind-mount.
 *
 * Compose stacks are otherwise jailed to their own materialized directory:
 * `resolveBindSource` (./compose-materialize.ts) rewrites every bind source to
 * a path inside the stack tree, and a stack with no materialized tree at all
 * has its binds dropped. That default is deliberate and stays. A stack that
 * could name any host path could mount `/`, `/root/.ssh`, or another tenant's
 * data directory into a container it controls.
 *
 * This is the narrow exception: an explicit set of paths, matched exactly, that
 * a compose file may bind anyway. Everything not listed is still denied, and
 * extending the list is a code change that goes through review. A user cannot
 * grant themselves a new path by editing their compose file.
 *
 * Being listed is NOT being granted. Each entry names the per-stack
 * grant it needs, and that grant is off for every stack until an installation
 * administrator turns it on for that one stack (`compose.setDockerSocketGrant`,
 * audited). There is no template provenance in the system: nothing records
 * which template a stack came from, so a listed path cannot be trusted to
 * "the Dozzle template we ship" over "a compose file a member pasted".
 *
 * THIS MODULE MUST STAY BROWSER-SAFE, no `node:` imports. The compose parser
 * reaches it (parse → normalize → here), and the parser runs in the SPA: the
 * template detail dialog parses a template's compose client-side to render it.
 * Importing `node:path` here for one `normalize()` call shipped a bundle whose
 * shim has no such export, and every template dialog died on
 * "Ur.normalize is not a function". The whole template catalog, not just the
 * stacks that bind a host path.
 */

/**
 * The per-stack grants an installation administrator has made. One field per
 * grantable path; read from the stack's `compose_resource` row, never from
 * anything the compose file or a tenant supplies.
 */
export interface HostBindGrants {
  /** `compose_resource.docker_socket_granted_at` is set. */
  dockerSocket: boolean;
}

/** What every stack has until an installation administrator says otherwise. */
export const NO_HOST_BIND_GRANTS: HostBindGrants = { dockerSocket: false };

interface HostBindGrant {
  /** The per-stack grant this path needs before it is mounted. */
  requires: keyof HostBindGrants;
  /** Forced onto the mount regardless of what the compose file asked for. */
  readOnly: boolean;
  /** Why this path is listed. Shown in no UI, read by the next person here. */
  reason: string;
}

/**
 * `/var/run/docker.sock` is root-equivalent, and `readOnly` is weaker than it
 * looks: the Docker API is HTTP over that socket, and a read-only *file* mode
 * does not stop API calls that create privileged containers. It is a guard
 * against casual writes, not a security boundary. It is listed because the log
 * viewers among the shipped templates (Dozzle) cannot function without it, and it needs an
 * install-admin grant per stack for exactly the reason above.
 */
const HOST_BIND_ALLOWLIST = new Map<string, HostBindGrant>([
  [
    "/var/run/docker.sock",
    {
      requires: "dockerSocket",
      readOnly: true,
      reason: "container log/stat viewers (Dozzle) read the daemon API",
    },
  ],
]);

export interface AllowedHostBind {
  source: string;
  readOnly: boolean;
}

/**
 * Collapse `//`, `.` and `..` in an absolute POSIX path.
 *
 * Hand-rolled rather than `node:path`: see the module note above. It is also
 * the more correct choice for the job: this normalizes a path that will be
 * handed to the DOCKER DAEMON, which is POSIX regardless of what the API
 * process runs on, so platform-dependent separator handling would be wrong.
 * `..` at the root is dropped, matching POSIX (`/..` is `/`).
 */
function normalizeAbsolute(source: string): string {
  const out: string[] = [];
  for (const seg of source.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return `/${out.join("/")}`;
}

/** The listed entry for an absolute `source`, matched on its normalized path. */
function listedHostBind(source: string): { path: string; grant: HostBindGrant } | null {
  if (!source.startsWith("/")) return null;
  const path = normalizeAbsolute(source);
  const grant = HOST_BIND_ALLOWLIST.get(path);
  return grant ? { path, grant } : null;
}

/**
 * The grant for a compose bind `source`, or null when the path is not listed,
 * or is listed but this stack does not hold the grant it needs, and the caller
 * should fall back to jailing it inside the stack directory.
 *
 * `grants` defaults to none: a caller that does not know the stack's grants
 * gets the safe answer. Matched on the normalized path so
 * `/var/run//docker.sock` and `/var/run/./docker.sock` cannot slip past by
 * spelling. Relative sources are never host binds (they belong to the stack
 * tree) so they never match.
 */
export function allowedHostBind(
  source: string,
  grants: HostBindGrants = NO_HOST_BIND_GRANTS,
): AllowedHostBind | null {
  const listed = listedHostBind(source);
  if (!listed || !grants[listed.grant.requires]) return null;
  return { source: listed.path, readOnly: listed.grant.readOnly };
}

/** True when `source` is a listed path, granted or not: the parse-time warning
 *  says "needs an install-admin grant" for these, "never mounted" otherwise. */
export function isGrantableHostBind(source: string): boolean {
  return listedHostBind(source) !== null;
}

/** Listed paths, for the parse-time warning that names what CAN be granted. */
export function allowedHostBindPaths(): string[] {
  return [...HOST_BIND_ALLOWLIST.keys()];
}

/**
 * Drop every stored bind mount whose source is a listed path this service's
 * stack does not hold the grant for. The deploy-time check, so a socket bind
 * stored before grants existed (or kept after a revoke) never reaches a container:
 * the reconcile path stops writing new ones, this stops honouring old ones.
 */
export function withoutUngrantedHostBinds<M extends { type: string; source: string | null }>(
  mounts: readonly M[],
  grants: HostBindGrants,
): M[] {
  return mounts.filter((m) => {
    if (m.type !== "bind" || !m.source) return true;
    const listed = listedHostBind(m.source);
    return !listed || grants[listed.grant.requires];
  });
}
