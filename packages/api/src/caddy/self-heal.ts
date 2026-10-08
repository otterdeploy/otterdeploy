/**
 * Edge (Caddy) admin self-healing. Split out of index.ts to keep that file
 * under the line cap.
 */

import type { RequestLogger } from "evlog";

import { Docker } from "@otterdeploy/docker";
import { env } from "@otterdeploy/env/server";
import { sleep } from "@otterdeploy/shared/promise";

import { asStepLogger } from "../lib/logger";
import { isSwarmRuntime } from "../runtime";
import { ensureEdgeOnProjectNetworks, findEdgeContainerId } from "../swarm/client";
import { loadCaddyfile, type LoadResult } from "./client";
import { controlPlaneEdgeWatch } from "./edge-watch";

/** Load the control-plane edge's config (with the self-heal below), then
 *  record what Caddy runs for the edge watch (./edge-watch.ts), with the
 *  database revision `caddyfile` was rendered from. */
export async function loadControlPlaneEdge(
  caddyfile: string,
  desiredRevision: string,
  rlog?: RequestLogger,
): Promise<LoadResult> {
  const loaded = await loadWithEdgeSelfHeal(caddyfile, rlog);
  // What the edge runs now: the edge watch reconciles when that changes
  // under it (a Caddy restart from the stub config), or when the database's
  // routes move on without this process loading them.
  if (loaded.ok) await controlPlaneEdgeWatch.recordLoaded(desiredRevision);
  return loaded;
}

/**
 * Load with a one-shot edge restart when Caddy's admin endpoint is wedged.
 *
 * The bundled crowdsec bouncer (v0.13.1) deadlocks Caddy's config apply: on
 * reload, `unsyncedStop → CrowdSec.Stop → Core.Shutdown` waits forever on its
 * stream goroutines while HOLDING the config mutex (captured live via
 * /debug/pprof/goroutine, od-664). From then on every /load and /config read
 * hangs; the data plane keeps serving, so nothing else notices. It wedged prod
 * twice in 36 hours: this is the standing recovery until the plugin is fixed
 * or replaced: restart the edge container (frees the lock; it boots from its
 * saved config, or the stub Caddyfile, in seconds), re-attach the project
 * bridge networks a recreated edge loses, and push the config again.
 *
 * Restarting the edge briefly drops traffic. Acceptable only because this
 * path is reached when the admin socket is already dead, i.e. the alternative
 * is an edge that can never receive another route again.
 */
async function loadWithEdgeSelfHeal(caddyfile: string, rlog?: RequestLogger): Promise<LoadResult> {
  const log = asStepLogger(rlog);
  const first = await loadCaddyfile(caddyfile, env.CADDY_ADMIN_URL, rlog);
  if (first.ok || !first.error.includes("timed out")) return first;

  log.error({
    caddy: { step: "self-heal", action: "restart-edge", reason: first.error },
  });
  let docker: Docker;
  try {
    docker = Docker.fromEnv();
  } catch {
    return first;
  }
  try {
    const edgeId = await findEdgeContainerId(docker);
    if (!edgeId) return first;
    const restarted = await docker.containers.getContainer(edgeId).restart({ t: 5 });
    if (restarted.isErr()) {
      log.error({
        caddy: { step: "self-heal", status: "restart-failed", detail: restarted.error.message },
      });
      return first;
    }
    // Give the admin socket a moment to come back, re-attach the bridge
    // networks the recreate dropped, then push the config once more.
    await sleep(3_000);
    if (!isSwarmRuntime()) await ensureEdgeOnProjectNetworks(rlog);
    const retry = await loadCaddyfile(caddyfile, env.CADDY_ADMIN_URL, rlog);
    log.info({
      caddy: { step: "self-heal", status: retry.ok ? "recovered" : "retry-failed" },
    });
    return retry;
  } finally {
    docker.destroy();
  }
}
