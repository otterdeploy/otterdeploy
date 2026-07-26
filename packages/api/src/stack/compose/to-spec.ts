/**
 * Map a normalized compose service → the platform's `SwarmServiceSpec`, the
 * same shape the single-service deploy path consumes. The deploy orchestrator
 * (`swarm/compose.ts`) calls this per service and feeds each spec to
 * `provisionSwarmService`, so a compose stack reuses the entire existing deploy
 * primitive. See docs/designs/compose.md.
 *
 * DEAD CODE as of the od-5j8.24 audit (2026-07-26): nothing in the live
 * create/deploy/reconcile/manifest-apply paths calls `composeServiceToSpec`
 * or `swarm/compose.ts#deployComposeStack` anymore — they were superseded by
 * `routers/compose/reconcile.ts#reconcileStackServices`, which materializes
 * each compose service as a real `service_resource` row and deploys it
 * through the normal per-service path (`routers/service/spec.ts#buildSwarmSpec`).
 * Only this file's own unit test (`__tests__/to-spec.test.ts`) exercises it.
 * Kept working rather than deleted since removing it wasn't in scope here —
 * flagged for a follow-up cleanup.
 *
 * Intra-stack DNS: each service's `internalHostname` is its bare compose name,
 * so `depends_on` peers reach it at `http://<name>` over the project overlay
 * network — exactly as compose promises. Named volumes are namespaced by stack
 * so two stacks with a `data` volume don't collide.
 */
import type { SpecMount, SwarmServiceRestart, SwarmServiceSpec } from "../../swarm";
import type { ParsedComposeService } from "./types";

import { PLATFORM } from "../../constants";

export interface ComposeSpecContext {
  resourceId: string;
  projectSlug: string;
  /** Stack namespace — prefixes swarm service + volume names. */
  stackName: string;
  /** Fully-resolved env for THIS service (project cascade + ${refs}). */
  resolvedEnv: Record<string, string>;
  /** Concrete image to run — the built tag for `build:` services. */
  image: string;
  deploymentId?: string | null;
  forceUpdateCounter: number;
}

/**
 * Swarm service name for a compose sub-service. The single source of truth for
 * the naming — used both at deploy (here) and by the live-task query that maps
 * swarm tasks back to their compose sub-service.
 *
 * The prefix is what makes the result a *minted* identity: a bare
 * `${stack}-${service}` is indistinguishable from any other alias on the
 * overlay network, so `caddy/route-validation.ts` cannot tell a legitimate
 * upstream from an arbitrary container a tenant asked to proxy to. It is the
 * same `od-` every other swarm service carries — one convention, and the short
 * form leaves room under Docker's 63-char cap for `${stack}-${service}`.
 */
export function composeSwarmServiceName(stackName: string, serviceName: string): string {
  return sanitize(`${PLATFORM.service.serviceNamePrefix}${stackName}-${serviceName}`).slice(0, 63);
}

export function composeServiceToSpec(
  svc: ParsedComposeService,
  ctx: ComposeSpecContext,
): SwarmServiceSpec {
  const serviceName = composeSwarmServiceName(ctx.stackName, svc.name);
  // Anonymous volumes are keyed off the *unprefixed* stack-service name on
  // purpose: the prefix exists so route validation can recognise a swarm
  // service, and folding it into volume identity would strand every existing
  // anonymous volume behind a renamed one on the next deploy.
  const volumeBase = sanitize(`${ctx.stackName}-${svc.name}`).slice(0, 63);

  return {
    resourceId: ctx.resourceId,
    resourceName: svc.name,
    projectSlug: sanitize(ctx.projectSlug),
    serviceName,
    // Bare compose name = the overlay DNS alias other services connect to.
    internalHostname: sanitize(svc.name),
    image: ctx.image,
    command: svc.command,
    entrypoint: svc.entrypoint,
    env: ctx.resolvedEnv,
    replicas: svc.replicas,
    restart: toRestart(svc.restart),
    healthcheck: toHealthcheck(svc),
    resources: {
      cpuLimit: svc.resources.cpus ? Number(svc.resources.cpus) : null,
      memoryLimitMb: svc.resources.memoryMb ?? null,
      cpuReservation: null,
      memoryReservationMb: null,
    },
    ports: svc.ports.map((p) => ({
      containerPort: p.target,
      protocol: p.protocol,
      // We can't infer L7 from compose; assume http for tcp, raw for udp.
      appProtocol: p.protocol === "udp" ? ("tcp" as const) : ("http" as const),
    })),
    mounts: toMounts(svc, volumeBase, ctx.stackName),
    forceUpdateCounter: ctx.forceUpdateCounter,
    deploymentId: ctx.deploymentId ?? null,
  };
}

/**
 * Compose `test` → the exec ARGS the swarm spec expects. `buildServiceSpec`
 * prepends `"CMD"` itself, so we must strip compose's `CMD`/`CMD-SHELL`
 * directive and, for shell form, re-express it as `/bin/sh -c <cmd>`.
 */
function toHealthcheck(svc: ParsedComposeService): SwarmServiceSpec["healthcheck"] {
  const hc = svc.healthcheck;
  if (!hc || hc.disable || hc.test.length === 0) return null;
  const head = hc.test[0];
  if (head === "NONE") return null;
  let cmd: string[];
  if (head === "CMD") cmd = hc.test.slice(1);
  else if (head === "CMD-SHELL") cmd = ["/bin/sh", "-c", hc.test.slice(1).join(" ")];
  else cmd = hc.test; // already bare exec args
  if (cmd.length === 0) return null;
  return {
    cmd,
    intervalMs: durationMs(hc.interval) ?? 30_000,
    timeoutMs: durationMs(hc.timeout) ?? 5_000,
    retries: hc.retries ?? 3,
    startPeriodMs: durationMs(hc.startPeriod) ?? 0,
  };
}

function toRestart(r: ParsedComposeService["restart"]): SwarmServiceRestart {
  const condition = r === "no" ? "none" : r === "on-failure" ? "on-failure" : "any";
  return { condition, maxAttempts: null, delayMs: 5_000 };
}

/** Volume mounts only — bind and tmpfs mounts are dropped here (NOT at
 *  parse: `normalize.ts` captures binds correctly). NOTE: as of od-5j8.24,
 *  this function and its caller (`composeServiceToSpec` /
 *  `swarm/compose.ts#deployComposeStack`) are dead code — no production
 *  path calls them; every compose deploy goes through
 *  `routers/compose/reconcile.ts#reconcileStackServices` →
 *  `reconcile-map.ts#toServiceFields` instead, which materializes each
 *  compose service as a real `service_resource` row and reuses the normal
 *  single-service deploy path. That's also where the actual (live) bind
 *  mount handling and od-5j8.24 compatibility gate (`compatibility.ts` via
 *  `routers/compose/deploy.ts#deployCompose`) live. Named volumes get the
 *  stack prefix; anonymous ones a stable derived name. */
function toMounts(svc: ParsedComposeService, volumeBase: string, stackName: string): SpecMount[] {
  const out: SpecMount[] = [];
  for (const v of svc.volumes) {
    if (v.type !== "volume") continue;
    const source = v.source
      ? `${stackName}-${v.source}`
      : `${volumeBase}-${sanitize(v.target).replace(/^-+/, "") || "data"}`;
    out.push({
      Type: "volume",
      Source: source,
      Target: v.target,
      ReadOnly: v.readOnly,
    });
  }
  return out;
}

/** Compose duration ("30s", "5ms", "1m", "1h", "500us", "10ns") → ms. */
export function durationMs(d: string | undefined): number | undefined {
  if (!d) return undefined;
  const m = d.trim().match(/^(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h)?$/);
  if (!m?.[1]) return undefined;
  const n = parseFloat(m[1]);
  switch (m[2]) {
    case "ns":
      return n / 1_000_000;
    case "us":
    case "µs":
      return n / 1_000;
    case "ms":
      return n;
    case "m":
      return n * 60_000;
    case "h":
      return n * 3_600_000;
    case "s":
    default:
      return n * 1_000;
  }
}

function sanitize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
