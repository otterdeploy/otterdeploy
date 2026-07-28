/**
 * Push a reconciled Caddyfile to one node's edge proxy.
 *
 * The node proxy's admin API is deliberately unpublished (see
 * provision-node-proxy — port 2019 stays inside the container), so config
 * travels over the same SSH transport that installed it rather than over an
 * admin port exposed to the network.
 *
 * The sequence is write-aside → validate → swap → reload, in that order,
 * because the obvious shortcut is wrong in a way that only shows up later:
 * overwriting the live file and reloading leaves a BAD config on disk when the
 * reload fails. Caddy keeps serving the old config from memory, everything
 * looks fine, and the node comes back with a broken edge the next time its
 * container restarts — an outage detached by hours from the change that caused
 * it. Validating a side file first means the live one is only ever replaced by
 * something Caddy has already accepted.
 *
 * Unchanged config is skipped entirely: reconcile runs often, and a reload per
 * run would churn connections for nothing.
 */

import { createHash } from "node:crypto";

import type { SshSession } from "../routers/server/ssh-exec";

import { NODE_PROXY_CONTAINER } from "../routers/server/provision-node-proxy";

/** Where the install script bind-mounts the edge config from. */
export const NODE_EDGE_DIR = "/etc/otterdeploy/edge";

/** Exit code meaning "config identical, nothing done" — not a failure. */
export const PUSH_UNCHANGED_EXIT = 75;
/** Exit code meaning the new config failed validation and was NOT applied. */
export const PUSH_INVALID_EXIT = 76;
/** Exit code meaning no edge proxy is running on this node. */
export const PUSH_NO_PROXY_EXIT = 77;

/** Short content hash, used both to skip no-op pushes and to label a revision. */
export function caddyfileRevision(caddyfile: string): string {
  return createHash("sha256").update(caddyfile).digest("hex").slice(0, 12);
}

/**
 * The push script. Pure, so the ordering guarantees above are assertable
 * without a node to push to.
 */
export function nodePushScript(caddyfile: string, sudo = ""): string {
  const S = sudo ? `${sudo} ` : "";
  const name = NODE_PROXY_CONTAINER;
  const b64 = Buffer.from(caddyfile, "utf8").toString("base64");
  const revision = caddyfileRevision(caddyfile);
  return [
    "set -euo pipefail",
    `if ! ${S}docker inspect ${name} >/dev/null 2>&1; then`,
    `  echo "no edge proxy on this node"`,
    `  exit ${PUSH_NO_PROXY_EXIT}`,
    "fi",
    `${S}mkdir -p ${NODE_EDGE_DIR}`,
    // Compare against what's live before doing anything. `|| true` because a
    // first push has no file to hash yet and `set -e` would abort.
    `CURRENT=$(${S}sha256sum ${NODE_EDGE_DIR}/Caddyfile 2>/dev/null | cut -c1-12 || true)`,
    `NEXT=$(printf '%s' '${b64}' | base64 -d | sha256sum | cut -c1-12)`,
    `if [ "$CURRENT" = "$NEXT" ]; then`,
    `  echo "edge config already at ${revision} — no reload"`,
    `  exit ${PUSH_UNCHANGED_EXIT}`,
    "fi",
    // Write aside. The live file is untouched until this one validates.
    `printf '%s' '${b64}' | base64 -d | ${S}tee ${NODE_EDGE_DIR}/Caddyfile.next >/dev/null`,
    `if ! ${S}docker exec ${name} caddy validate --config /etc/caddy/Caddyfile.next --adapter caddyfile >/dev/null 2>&1; then`,
    `  echo "new edge config rejected by caddy validate — keeping the current one"`,
    `  ${S}rm -f ${NODE_EDGE_DIR}/Caddyfile.next`,
    `  exit ${PUSH_INVALID_EXIT}`,
    "fi",
    // mv within the same filesystem is atomic, so a crash mid-swap can never
    // leave a half-written config where the live one was.
    `${S}mv ${NODE_EDGE_DIR}/Caddyfile.next ${NODE_EDGE_DIR}/Caddyfile`,
    `${S}docker exec ${name} caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile`,
    `echo "edge config applied at ${revision}"`,
  ].join("\n");
}

export type NodePushOutcome =
  | { kind: "applied"; revision: string }
  | { kind: "unchanged"; revision: string }
  /** Validation rejected it; the node kept its previous config. */
  | { kind: "invalid"; revision: string }
  /** Node has no edge proxy — not an error, just nothing to push to. */
  | { kind: "no-proxy" }
  | { kind: "failed"; error: string };

export async function pushNodeCaddyfile(
  session: SshSession,
  caddyfile: string,
  opts: { privilege: "root" | "sudo" | "none"; onLine?: (line: string) => void },
): Promise<NodePushOutcome> {
  const revision = caddyfileRevision(caddyfile);
  if (opts.privilege === "none") {
    return { kind: "failed", error: "no privileged access to this node" };
  }
  const sudo = opts.privilege === "sudo" ? "sudo" : "";
  const res = await session.runScript(nodePushScript(caddyfile, sudo), opts.onLine);
  switch (res.exitCode) {
    case 0:
      return { kind: "applied", revision };
    case PUSH_UNCHANGED_EXIT:
      return { kind: "unchanged", revision };
    case PUSH_INVALID_EXIT:
      return { kind: "invalid", revision };
    case PUSH_NO_PROXY_EXIT:
      return { kind: "no-proxy" };
    default:
      return { kind: "failed", error: res.output.trim().split("\n").slice(-3).join(" ") };
  }
}
