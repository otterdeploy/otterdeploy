/**
 * Manifest service block → the `createService` input shape.
 *
 * Split out of `manifest-apply-services.ts`, which owns the apply
 * orchestration (create / update / domain seeding) and was at the line cap.
 * These are pure mappers: no IO, no Result, one manifest concept each.
 */

import type {
  EnvironmentId,
  GitRepoId,
  OrganizationId,
  ProjectId,
  ServerId,
} from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import type { ServiceManifest } from "../../stack/manifest";

import { createService } from "../service/handlers";
import { gitSourceColumns } from "./manifest-apply-git";
import { withSecretFlags } from "./manifest-secret-flags";

export function buildPortsPatch(spec: ServiceManifest) {
  return spec.ports?.map((p) => ({
    containerPort: p.container,
    protocol: p.protocol,
    appProtocol: p.appProtocol,
    isPrimary: p.primary,
  }));
}

export function buildHealthcheckPatch(spec: ServiceManifest) {
  return spec.healthcheck
    ? {
        cmd: spec.healthcheck.cmd,
        intervalMs: spec.healthcheck.intervalMs ?? null,
        timeoutMs: spec.healthcheck.timeoutMs ?? null,
        retries: spec.healthcheck.retries ?? null,
        startMs: spec.healthcheck.startMs ?? null,
      }
    : undefined;
}

export function buildResourcesPatch(spec: ServiceManifest) {
  return spec.resources
    ? {
        cpuLimit: spec.resources.cpuLimit ?? null,
        memoryLimitMb: spec.resources.memoryMb ?? null,
        cpuReservation: spec.resources.cpuReservation ?? null,
        memoryReservationMb: spec.resources.memoryReservationMb ?? null,
        diskLimitMb: spec.resources.diskMb ?? null,
        swapLimitMb: spec.resources.swapMb ?? null,
        pidsLimit: spec.resources.pidsLimit ?? null,
      }
    : undefined;
}

export interface CreateServiceArgs {
  projectId: ProjectId;
  /** Environment the service is created in. Scopes the name check and gets
   *  stamped on the row. */
  environmentId: EnvironmentId;
  organizationId: OrganizationId;
  name: string;
  spec: ServiceManifest;
  env: Array<{ key: string; value: string }>;
  log: RequestLogger;
}

export function buildCreateServiceInput(
  args: CreateServiceArgs,
  gitRepoId: GitRepoId | null,
  placementServerId: ServerId | null,
): Parameters<typeof createService>[0] {
  // Git-sourced services start with a placeholder image. The builder
  // overwrites it on first build. The existing handler accepts the
  // placeholder; we still pass the manifest's command/entrypoint.
  const image = args.spec.source === "image" ? args.spec.image : "pending:initial";
  return {
    projectId: args.projectId,
    environmentId: args.environmentId,
    organizationId: args.organizationId,
    name: args.name,
    placementServerId,
    source: args.spec.source,
    ...gitSourceColumns(args.spec, gitRepoId),
    // A git create on an unbound project should still land as a
    // `pending:initial` row (swarm skipped). The missing build binding
    // surfaces below as a non-fatal "build not started" skip, not a hard
    // create failure that leaves the ghost stuck forever.
    skipBuildBindingCheck: true,
    sourceSubdir:
      args.spec.source === "git" || args.spec.source === "upload"
        ? (args.spec.sourceSubdir ?? null)
        : null,
    image,
    command: args.spec.startCommand ?? null,
    entrypoint: args.spec.entrypoint ?? null,
    replicas: args.spec.replicas ?? 1,
    ports: buildPortsPatch(args.spec) ?? [],
    // Flags carried from the manifest's `secrets` list; a create that dropped
    // them would leave the first apply's rows unflagged (od-w2r).
    env: args.env.length > 0 ? withSecretFlags(args.env, args.spec.secrets) : undefined,
    healthcheck: buildHealthcheckPatch(args.spec),
    restart: args.spec.restart,
    resources: buildResourcesPatch(args.spec),
    preDeploy: args.spec.preDeploy ?? null,
    postDeploy: args.spec.postDeploy ?? null,
    buildConfig:
      args.spec.source === "git" || args.spec.source === "upload"
        ? (args.spec.build ?? null)
        : null,
  };
}
