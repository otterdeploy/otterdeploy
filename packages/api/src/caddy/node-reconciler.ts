/**
 * Reconcile every node's edge proxy.
 *
 * The control-plane edge is reconciled in-process over its admin socket (see
 * ./index reconcile). Every other node gets the same treatment over SSH: build
 * the subset of routes that node should serve, render it, push it.
 *
 * Node edges are BEST-EFFORT and reported per node. One unreachable machine
 * must not fail the reconcile for the rest — the control-plane edge has
 * already been updated by then, and it still serves every unplaced route, so a
 * node that misses an update degrades rather than breaks. What it must not do
 * is fail silently, hence an outcome per node.
 *
 * Only servers with a stored SSH key are reachable: the bootstrap password is
 * never persisted, so a node joined by password alone has nothing left to
 * reconnect with. Those are reported, not skipped quietly.
 */

import type { OrganizationId, ServerId, SshKeyId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { decryptForDomain } from "../lib/crypto";
import { asStepLogger } from "../lib/logger";
import { parseProbe, probeScript } from "../routers/server/provision";
import { listAllServers } from "../routers/server/queries";
import { SshSession } from "../routers/server/ssh-exec";
import { getSshKeyInOrg } from "../routers/sshKeys/queries";
import { buildCaddyfile, type ProxyRouteInput } from "./builder";
import { type NodePushOutcome, pushNodeCaddyfile } from "./node-push";
import { type RoutePlacement, routesForNode } from "./node-routes";

export interface NodeEdgeResult {
  serverId: ServerId;
  serverName: string;
  routeCount: number;
  outcome: NodePushOutcome;
}

/** A route paired with the server its resource is pinned to. */
export interface PlacedRoute extends RoutePlacement {
  route: ProxyRouteInput;
}

export interface NodeReconcileOptions {
  /** Every enabled route, each carrying its resource's placement. */
  placed: readonly PlacedRoute[];
  /** The server running the control plane — it keeps the unplaced routes and
   *  is reconciled in-process, so it is skipped here. */
  controlPlaneServerId: ServerId | null;
  /** Caddyfile build options, same ones the control-plane edge is built with. */
  buildOptions: Parameters<typeof buildCaddyfile>[2];
  adminBind: string;
  rlog?: RequestLogger;
}

/**
 * Render the Caddyfile for one node. Exported so the UI can show an operator
 * exactly what a given node is serving without pushing anything.
 */
function renderNodeCaddyfile(
  placed: readonly PlacedRoute[],
  serverId: ServerId,
  opts: { adminBind: string; buildOptions: Parameters<typeof buildCaddyfile>[2] },
): { caddyfile: string; routeCount: number } {
  // A worker never inherits unplaced routes — serving a route whose backend is
  // on another machine answers with a cert it can get and a backend it can't
  // reach.
  const split = routesForNode(placed, serverId, false);
  const routes = split.routes.map((r) => (r as PlacedRoute).route);
  return {
    caddyfile: buildCaddyfile(routes, opts.adminBind, opts.buildOptions),
    routeCount: routes.length,
  };
}

export async function reconcileNodeEdges(options: NodeReconcileOptions): Promise<NodeEdgeResult[]> {
  const log = asStepLogger(options.rlog);
  const servers = await listAllServers();
  const results: NodeEdgeResult[] = [];

  for (const server of servers) {
    if (server.id === options.controlPlaneServerId) continue;
    // A node that never finished provisioning has no edge to push to.
    if (server.provisionStatus !== "ready") continue;

    const { caddyfile, routeCount } = renderNodeCaddyfile(options.placed, server.id, {
      adminBind: options.adminBind,
      buildOptions: options.buildOptions,
    });

    // Each server carries its own org — the SSH key lives in that org's
    // keystore, and reading it from anywhere else would cross a tenant boundary.
    const push = await pushOneNode(server, server.organizationId as OrganizationId, caddyfile);
    results.push({
      serverId: server.id,
      serverName: server.name,
      routeCount,
      outcome: push,
    });

    log.info({
      caddy: {
        step: "node-edge",
        server: server.name,
        routeCount,
        outcome: push.kind,
        ...(push.kind === "failed" ? { detail: push.error } : {}),
      },
    });
  }

  return results;
}

async function pushOneNode(
  server: { id: ServerId; host: string; sshPort: number; sshUser: string; sshKeyId: string | null },
  organizationId: OrganizationId,
  caddyfile: string,
): Promise<NodePushOutcome> {
  if (!server.sshKeyId) {
    return {
      kind: "failed",
      error: "no stored SSH key — this node was joined by password and cannot be reached again",
    };
  }

  try {
    const key = await getSshKeyInOrg({ id: server.sshKeyId as SshKeyId, organizationId });
    if (!key?.privateKeyCiphertext) {
      return { kind: "failed", error: "the stored SSH key has no private half" };
    }
    const privateKey = await decryptForDomain(key.privateKeyCiphertext, "ssh-keys");

    const session = await SshSession.connect({
      host: server.host,
      port: server.sshPort,
      user: server.sshUser,
      privateKey,
    });
    try {
      const probe = parseProbe((await session.runScript(probeScript())).output);
      return await pushNodeCaddyfile(session, caddyfile, { privilege: probe.privilege });
    } finally {
      session.dispose();
    }
  } catch (cause) {
    // Unreachable/auth failures are per-node facts, not reconcile failures —
    // the control-plane edge is already updated and still serves every
    // unplaced route.
    return { kind: "failed", error: cause instanceof Error ? cause.message : String(cause) };
  }
}
