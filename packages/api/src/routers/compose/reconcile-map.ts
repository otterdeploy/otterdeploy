/**
 * Pure mapping from a parsed compose service → the service-row create/update
 * shape, plus project-unique resource-name selection. Split out of reconcile.ts
 * to keep the orchestration module under the line cap. See docs/designs/compose.md.
 */
import type { ProjectId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { resource } from "@otterdeploy/db/schema/project";
import { isSecretKey } from "@otterdeploy/shared/env-var-kind";
import { and, eq } from "drizzle-orm";

import type { StackReconcileContext } from "./reconcile";

import { PLATFORM } from "../../constants";
import { resolveBindSource } from "../../lib/compose-materialize";
import { allowedHostBind } from "../../lib/host-binds";
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
interface MappedMount {
  type: "volume" | "bind" | "file";
  target: string;
  source: string | null;
  content: string | null;
  readOnly: boolean;
}

/**
 * The docker volume backing a compose named volume, scoped to its stack.
 *
 * Compose volume names are file-local (`data`, `db-data`), so two stacks in a
 * project would otherwise share one docker volume and each other's data. Same
 * `od-<stack>-<name>` shape as composeSwarmServiceName, for the same reason.
 */
export function composeVolumeName(stackName: string, volumeName: string): string {
  return `${PLATFORM.service.serviceNamePrefix}${stackName}-${volumeName}`
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .slice(0, 63);
}

/**
 * Compose mounts → the runtime's mount records.
 *
 * NAMED VOLUMES were previously dropped here. The loop skipped everything that
 * was not a bind, and the comment claimed they were "left as-is". They were not
 * left anywhere. Nothing mounted them, so a service either fell back to an
 * ANONYMOUS volume created by its image's own VOLUME directive (a fresh, empty
 * one on every redeploy: silent data loss for rustfs and every bundled
 * Postgres) or got no persistence at all. Vaultwarden is the only reason this
 * surfaced: it refuses to start without a real mount at /data and said so.
 *
 * Bind mounts still need a materialized file tree (`stackDir`, multi-file
 * inline stacks); named volumes need nothing. Docker creates them on first
 * use, and a deterministic name means a redeploy reattaches the same data.
 *
 * ALLOWLISTED HOST BINDS are checked before the `stackDir` guard, and that
 * order is the whole fix. A single-file stack (every catalog template) has no
 * materialized tree, so the guard dropped its binds outright. The Dozzle
 * template asked for the docker socket, silently got no mount at all, and
 * crash-looped on "Could not connect to any Docker Engine". See ../../lib/
 * host-binds.ts for what is listed and why the list is short.
 */
function toMounts(svc: ParsedComposeService, ctx: StackReconcileContext): MappedMount[] {
  const out: MappedMount[] = [];
  for (const v of svc.volumes) {
    if (v.type === "volume" && v.source) {
      out.push({
        type: "volume",
        target: v.target,
        source: composeVolumeName(ctx.stackName, v.source),
        content: null,
        readOnly: v.readOnly,
      });
      continue;
    }
    if (v.type !== "bind" || !v.source) continue;
    const granted = allowedHostBind(v.source);
    if (granted) {
      out.push({
        type: "bind",
        target: v.target,
        source: granted.source,
        content: null,
        // The grant decides, not the file: a compose asking for the socket
        // read-write does not get to widen what the allowlist handed out.
        readOnly: granted.readOnly,
      });
      continue;
    }
    if (!ctx.stackDir) continue;
    const abs = resolveBindSource(v.source, ctx.stackDir);
    if (!abs) continue;
    out.push({ type: "bind", target: v.target, source: abs, content: null, readOnly: v.readOnly });
  }
  return out;
}

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
  env: Array<{ key: string; value: string; isSecret: boolean }>;
  /** Named volumes, allowlisted host binds, and. For a multi-file inline stack.
   *  Binds resolved into the materialized tree. Seeded on create; only the
   *  allowlisted host binds are re-applied on update (reconcile-materialize). */
  mounts: MappedMount[];
} {
  const projectSlug = sanitizeSlug(ctx.projectSlug);
  // Interpolate compose env against the project bag, then flatten to the
  // {key,value} rows createServiceRecord seeds.
  const { env: resolvedEnv } = substituteComposeEnv(svc.env, ctx.projectVars);
  // Flag credentials as they are written. Nothing on the compose path ever set
  // this, so every child service stored its secrets unflagged and any UI that
  // trusts the flag rendered AUTHENTIK_SECRET_KEY and POSTGRES_PASSWORD in the
  // clear. Same classifier the wizard and the template modal use, so all three
  // agree on what counts as a secret.
  const env = Object.entries(resolvedEnv).map(([key, value]) => ({
    key,
    value,
    isSecret: isSecretKey(key),
  }));
  // First http-ish port (tcp) is the primary, the one a public domain fronts.
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
    mounts: toMounts(svc, ctx),
  };
}

/**
 * Project-unique resource name for a new stack service, namespaced by its stack.
 *
 * `authentik` + `server` → `authentik-server`, not `server`. Compose service
 * keys are written for the file's own scope, so half the catalog names its main
 * container `server`, `web`, `app` or `db`. Those became the resource name AND,
 * through it, the generated host, so Authentik's UI landed on
 * `server-store.<ip>.sslip.io`, which says nothing about what it serves and
 * collides with the next stack that also has a `server`.
 *
 * The exception is the namesake: a single-service stack named after its service
 * (`rustfs` containing `rustfs`) would otherwise become `rustfs-rustfs`. There
 * the stack's own name IS the answer, so the child takes it, and the stack
 * resource already owns that name, which is what the numeric fallback below is
 * for. This replaces the old `-service` suffix, which put a disambiguator the
 * operator never chose into every URL.
 *
 * Forward-only: reconcile matches existing children on `serviceName` (derived
 * from stackName + compose key, never renamed), so stacks deployed before this
 * keep the names they have.
 */
export async function pickResourceName(
  projectId: ProjectId,
  composeName: string,
  stackName: string,
): Promise<string> {
  const base = (composeName === stackName ? stackName : `${stackName}-${composeName}`).slice(0, 60);
  // The namesake case ALWAYS lands here: the stack resource already owns that
  // exact name, so candidate 0 can never be free for it. `-service` says what
  // the row is; `-2` implies a sibling that does not exist (and is what shipped
  // for a moment: `vaultwarden-2`).
  const candidateAt = (i: number) =>
    i === 0 ? base : i === 1 ? `${base}-service` : `${base}-${i}`;
  for (let i = 0; i < 50; i++) {
    const candidate = candidateAt(i);
    const [exists] = await db
      .select({ id: resource.id })
      .from(resource)
      .where(and(eq(resource.projectId, projectId), eq(resource.name, candidate)))
      .limit(1);
    if (!exists) return candidate;
  }
  // Extremely unlikely: fall back to a stack-scoped suffix.
  return `${base}-${composeName.length}`;
}
