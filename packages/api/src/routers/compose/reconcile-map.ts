/**
 * Pure mapping from a parsed compose service → the service-row create/update
 * shape, plus project-unique resource-name selection. Split out of reconcile.ts
 * to keep the orchestration module under the line cap. See docs/designs/compose.md.
 */
import type { ProjectId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { resource } from "@otterdeploy/db/schema/project";
import { and, eq } from "drizzle-orm";

import type { StackReconcileContext } from "./reconcile";

import { PLATFORM } from "../../constants";
import { resolveBindSource } from "../../lib/compose-materialize";
import {
  composeSwarmServiceName,
  durationMs,
  type ParsedComposeService,
} from "../../stack/compose";
import { type CreateServiceInput } from "../service/queries";
import { sanitizeSlug } from "../service/views";
import { interpolate, substituteComposeEnv } from "./env";

const sanitize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Compose `restart:` → the service resource's restart condition enum. */
function toRestartCondition(r: ParsedComposeService["restart"]): "none" | "on-failure" | "any" {
  if (r === "no") return "none";
  if (r === "on-failure") return "on-failure";
  return "any";
}

/** Compose healthcheck → the service resource's healthcheck columns. Mirrors
 *  `to-spec.ts#toHealthcheck`: strip compose's CMD/CMD-SHELL directive (the
 *  swarm provisioner re-adds CMD), shell form → `/bin/sh -c <cmd>`. */
function toHealthcheck(svc: ParsedComposeService): {
  healthcheckCmd: string[] | null;
  healthcheckIntervalMs: number | null;
  healthcheckTimeoutMs: number | null;
  healthcheckRetries: number | null;
  healthcheckStartMs: number | null;
} {
  const hc = svc.healthcheck;
  const none = {
    healthcheckCmd: null,
    healthcheckIntervalMs: null,
    healthcheckTimeoutMs: null,
    healthcheckRetries: null,
    healthcheckStartMs: null,
  };
  if (!hc || hc.disable || hc.test.length === 0) return none;
  const head = hc.test[0];
  if (head === "NONE") return none;
  let cmd: string[];
  if (head === "CMD") cmd = hc.test.slice(1);
  else if (head === "CMD-SHELL") cmd = ["/bin/sh", "-c", hc.test.slice(1).join(" ")];
  else cmd = hc.test;
  if (cmd.length === 0) return none;
  return {
    healthcheckCmd: cmd,
    healthcheckIntervalMs: durationMs(hc.interval) ?? 30_000,
    healthcheckTimeoutMs: durationMs(hc.timeout) ?? 5_000,
    healthcheckRetries: hc.retries ?? 3,
    healthcheckStartMs: durationMs(hc.startPeriod) ?? 0,
  };
}

/** Map a parsed compose service → the create/update shape for its service row.
 *  Image/command/entrypoint/env are interpolated against the project bag, so
 *  what we store + deploy is fully concrete (no `${VAR}` reaches swarm). */
export function toServiceFields(
  svc: ParsedComposeService,
  ctx: StackReconcileContext,
  image: string,
): {
  serviceName: string;
  internalHostname: string;
  networkName: string;
  fields: Pick<
    CreateServiceInput,
    | "image"
    | "command"
    | "entrypoint"
    | "replicas"
    | "restartCondition"
    | "healthcheckCmd"
    | "healthcheckIntervalMs"
    | "healthcheckTimeoutMs"
    | "healthcheckRetries"
    | "healthcheckStartMs"
    | "cpuLimit"
    | "memoryLimitMb"
  >;
  ports: CreateServiceInput["ports"];
  env: Array<{ key: string; value: string }>;
  /** Bind mounts for a multi-file inline stack (source → materialized host
   *  path). Empty for single-file / git stacks. Seeded on create only. */
  mounts: Array<{
    type: "volume" | "bind" | "file";
    target: string;
    source: string | null;
    content: string | null;
    readOnly: boolean;
  }>;
} {
  const projectSlug = sanitizeSlug(ctx.projectSlug);
  // Interpolate compose env against the project bag, then flatten to the
  // {key,value} rows createServiceRecord seeds.
  const { env: resolvedEnv } = substituteComposeEnv(svc.env, ctx.projectVars);
  const env = Object.entries(resolvedEnv).map(([key, value]) => ({ key, value }));
  // First http-ish port (tcp) is the primary — the one a public domain fronts.
  const seenPorts = new Set<number>();
  let primaryAssigned = false;
  const ports: CreateServiceInput["ports"] = [];
  for (const p of svc.ports) {
    if (seenPorts.has(p.target)) continue;
    seenPorts.add(p.target);
    const appProtocol = p.protocol === "udp" ? ("tcp" as const) : ("http" as const);
    const isPrimary = !primaryAssigned && appProtocol === "http";
    if (isPrimary) primaryAssigned = true;
    ports.push({
      containerPort: p.target,
      protocol: p.protocol,
      appProtocol,
      isPrimary,
    });
  }
  // Bind mounts only, and only when the stack materialized its file tree
  // (multi-file inline). Each bind source resolves to an absolute path under
  // `stackDir`; the runtime bind-mounts it (materializeServiceMounts already
  // supports type:"bind"). Named volumes + tmpfs are left as-is (unchanged from
  // today) to avoid touching how every existing compose stack deploys.
  const mounts: Array<{
    type: "volume" | "bind" | "file";
    target: string;
    source: string | null;
    content: string | null;
    readOnly: boolean;
  }> = [];
  if (ctx.stackDir) {
    for (const v of svc.volumes) {
      if (v.type !== "bind" || !v.source) continue;
      const abs = resolveBindSource(v.source, ctx.stackDir);
      if (!abs) continue;
      mounts.push({ type: "bind", target: v.target, source: abs, content: null, readOnly: v.readOnly });
    }
  }

  return {
    serviceName: composeSwarmServiceName(ctx.stackName, svc.name),
    // Bare compose name = the overlay DNS alias intra-stack peers connect to.
    internalHostname: sanitize(svc.name),
    networkName: `${PLATFORM.swarm.networkPrefix}${projectSlug}`,
    fields: {
      image,
      command: svc.command?.map((c) => interpolate(c, ctx.projectVars)) ?? null,
      entrypoint: svc.entrypoint?.map((c) => interpolate(c, ctx.projectVars)) ?? null,
      replicas: svc.replicas,
      restartCondition: toRestartCondition(svc.restart),
      ...toHealthcheck(svc),
      cpuLimit: svc.resources.cpus ? String(svc.resources.cpus) : null,
      memoryLimitMb: svc.resources.memoryMb ?? null,
    },
    ports,
    env,
    mounts,
  };
}

/** Pick a project-unique resource name for a new stack service. Prefers the
 *  bare compose key (e.g. "web"); if another resource already owns that name,
 *  suffix until free. Matching on re-reconcile keys off serviceName, so a
 *  suffixed display name stays stable. */
export async function pickResourceName(projectId: ProjectId, composeName: string): Promise<string> {
  const base = composeName.slice(0, 60);
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const [exists] = await db
      .select({ id: resource.id })
      .from(resource)
      .where(and(eq(resource.projectId, projectId), eq(resource.name, candidate)))
      .limit(1);
    if (!exists) return candidate;
  }
  // Extremely unlikely — fall back to a stack-scoped suffix.
  return `${base}-${composeName.length}`;
}
