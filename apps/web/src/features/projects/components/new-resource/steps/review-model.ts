/**
 * Everything the Review step *computes*: the generated compose.yml and the
 * model the summary card reads. Split out of review.tsx so that file is just
 * the rendered story — this half is pure, has no JSX, and is where the
 * "preview == staged" promise is actually kept (image resolution, public
 * hostnames and sizing all go through the same mappers the create payload
 * uses).
 */

import { POSTGRES_EXTENSIONS, resolvePostgresImage } from "@otterdeploy/shared/postgres-extensions";

import { RESOURCE_PRESETS, type ServiceKind } from "@/features/projects/data/service-kinds";

import type { ResourceFormState } from "../schemas";

import { traitsFor } from "../engine-traits";
import { domainsFromPorts } from "../to-manifest";

export interface ComposeArgs {
  isDb: boolean;
  kindId: string;
  name: string;
  dbImage: string;
  isPg: boolean;
  extensions: string[];
  cpu: number;
  mem: number;
  replicas: number;
  publicEnabled: boolean;
  /** Pre-built image ref for docker-kind services ("" for git builds). */
  serviceImage: string;
  /** Public hostnames this service's manifest will seed (services only —
   *  same mapper as the create payload, so preview == staged). */
  serviceDomains: string[];
  healthPath: string;
  healthInterval: number;
}

// Preview mirrors what actually deploys: a plain named volume (the
// provisioner applies no size/driver_opts — see the Storage step) and the
// hardcoded start-first/rollback update strategy from the swarm driver.
function generateComposeYaml(args: ComposeArgs): string {
  const { isDb, kindId, name, dbImage, isPg, extensions, cpu, mem, replicas } = args;
  const memStr = mem >= 1024 ? `${mem / 1024}G` : `${mem}M`;
  if (isDb) {
    const mountTarget = traitsFor(kindId).mountTarget;
    const extLine =
      isPg && extensions.length > 0 ? `\n    # extensions: ${extensions.join(", ")}` : "";
    return `services:
  ${name}:
    image: ${dbImage}${extLine}
    deploy:
      replicas: 1
      resources:
        limits: { cpus: '${cpu}', memory: ${memStr} }
    volumes:
      - ${name}-data:${mountTarget}
    networks: [internal${args.publicEnabled ? ", public" : ""}]

volumes:
  ${name}-data:`;
  }
  const imageLine = args.serviceImage
    ? `\n    image: ${args.serviceImage}`
    : `\n    # image: built from source on deploy`;
  const healthBlock =
    args.healthPath.trim() !== ""
      ? `\n    healthcheck:
      test: wget/curl http://127.0.0.1:<primary port>${args.healthPath.trim()}
      interval: ${args.healthInterval}s`
      : "";
  const isPublic = args.serviceDomains.length > 0;
  const routeLines = isPublic
    ? args.serviceDomains.map((d) => `\n    # public route: https://${d}`).join("")
    : "";
  return `services:
  ${name}:${imageLine}${routeLines}${healthBlock}
    deploy:
      replicas: ${replicas}
      resources:
        limits: { cpus: '${cpu}', memory: ${memStr} }
      update_config:
        order: start-first
        failure_action: rollback
    networks: [internal${isPublic ? ", public" : ""}]`;
}

/** vCPU + memory per replica: a chosen preset wins, otherwise the custom
 *  sliders. Split out of buildReviewModel — the fallback pair is one decision,
 *  not two independent ones. */
function resolveSize(values: ResourceFormState): { cpu: number; mem: number } {
  const preset = RESOURCE_PRESETS.find((p) => p.id === values.presetId);
  return { cpu: preset?.cpu ?? values.customCpu, mem: preset?.mem ?? values.customMem };
}

/** The database image the deploy will actually pull. Split out of
 *  buildReviewModel because of the postgres wrinkle: non-contrib extensions
 *  pin a specific image, so the preview has to resolve them or the image line
 *  would lie about what deploys. */
function resolveDbImage(
  kind: ServiceKind,
  version: ResourceFormState["version"],
  extensions: string[],
): string {
  const fallback = `${kind.id}:${version}`;
  if (kind.id !== "postgres") return fallback;
  const resolved = resolvePostgresImage(extensions, fallback);
  return resolved.ok ? resolved.image : fallback;
}

/** The image ref for a non-database service: docker kinds deploy the exact ref
 *  typed on the Image step, git kinds get theirs from the first build (so ""
 *  here, and the compose preview says so). Split out of buildReviewModel. */
function resolveServiceImage(kind: ServiceKind, values: ResourceFormState): string {
  if (kind.id !== "docker" || !values.image) return "";
  return values.tag ? `${values.image}:${values.tag}` : values.image;
}

/** Public hostnames the service's manifest will seed. Split out of
 *  buildReviewModel to keep it honest: this derives from the SAME mapper the
 *  create payload uses (domainsFromPorts). Review previously read the
 *  database-only `publicEnabled` flag for services, so a Public port toggle
 *  reviewed as "Internal only" while the diff staged routes. Preview ==
 *  staged, always. */
function resolveServiceDomains(
  kind: ServiceKind,
  isDb: boolean,
  values: ResourceFormState,
  derivedHost: string | null,
): string[] {
  if (isDb || kind.id === "static") return [];
  return (domainsFromPorts(values.ports, derivedHost) ?? []).map((d) => d.domain);
}

/** Derive every value the Review JSX renders from the live form state.
 *  Pulling this out of the render prop keeps that callback under the
 *  cyclomatic-complexity cap. */
export function buildReviewModel(
  kind: ServiceKind,
  values: ResourceFormState,
  derivedHost: string | null,
) {
  const { name, version, replicas } = values;
  const { publicEnabled, healthPath, healthInterval } = values;
  const { cpu, mem } = resolveSize(values);
  const isDb = kind.group === "database";

  // Selected postgres extensions (names), with their display labels.
  const extensions = (values.extensions as string[] | undefined) ?? [];
  const isPg = kind.id === "postgres";
  const extensionLabels = extensions
    .map((n) => POSTGRES_EXTENSIONS.find((e) => e.name === n)?.label ?? n)
    .join(", ");

  const serviceDomains = resolveServiceDomains(kind, isDb, values, derivedHost);

  const compose = generateComposeYaml({
    isDb,
    kindId: kind.id,
    name,
    dbImage: resolveDbImage(kind, version, extensions),
    isPg,
    extensions,
    cpu,
    mem,
    replicas,
    publicEnabled,
    serviceImage: resolveServiceImage(kind, values),
    serviceDomains,
    healthPath: kind.id === "static" ? "" : healthPath,
    healthInterval,
  });

  return {
    name,
    version,
    cpu,
    mem,
    isDb,
    isPg,
    replicas,
    publicEnabled,
    serviceDomains,
    // Databases publish through the exposed flag; services publish because a
    // port mapped to a hostname.
    isPublic: isDb ? publicEnabled : serviceDomains.length > 0,
    extensions,
    extensionLabels,
    compose,
    mountTarget: isDb ? traitsFor(kind.id).mountTarget : null,
  };
}

export type ReviewModel = ReturnType<typeof buildReviewModel>;
