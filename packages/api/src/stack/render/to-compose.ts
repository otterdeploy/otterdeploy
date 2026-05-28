/**
 * Emit compose-compatible YAML from a StackFile.
 *
 * The compose YAML is a one-way export — disaster-recovery snapshot,
 * `docker stack deploy -c` fallback, audit artifact. The DB is the
 * source of truth; nothing parses this output back in. So everything
 * we emit should be pure compose.
 *
 * We project the otterdeploy identity bits (kind, resource.id,
 * project.id, engine) into `deploy.labels` so tools that only see the
 * compose subset — `docker service ls --filter label=...`, `docker
 * inspect`, third-party operators — can still find and group resources
 * we own without parsing custom extensions. Other otterdeploy
 * metadata (preDeploy, buildConfig, publicEnabled, …) is *not*
 * mirrored into the YAML — read it from the manifest / UI / CLI
 * instead.
 *
 * Determinism: keys are sorted alphabetically before emit so two
 * structurally-equal inputs always produce byte-identical output.
 */

import type { StackFile, StackOtterdeployExtension, StackService } from "../schema";

type SortableObject = Record<string, unknown>;
type SortableValue = unknown;

function sortDeep(value: SortableValue): SortableValue {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value === null || typeof value !== "object") return value;
  const obj = value as SortableObject;
  const out: SortableObject = {};
  for (const key of Object.keys(obj).sort()) {
    const v = obj[key];
    if (v === undefined) continue;
    out[key] = sortDeep(v);
  }
  return out;
}

function identityLabels(
  x: StackOtterdeployExtension,
): Record<string, string> {
  const labels: Record<string, string> = {
    "otterdeploy.kind": x.kind,
    "otterdeploy.resource.id": x.resourceId,
    "otterdeploy.project.id": x.projectId,
  };
  if (x.engine) labels["otterdeploy.engine"] = x.engine;
  return labels;
}

function prepareService(service: StackService): SortableObject {
  const labels = identityLabels(service["x-otterdeploy"]);
  const deploy = service.deploy ? { ...service.deploy } : {};
  deploy.labels = { ...labels, ...deploy.labels };

  const ports = service.ports?.map((p) => ({
    target: p.target,
    protocol: p.protocol,
    mode: p.mode ?? "ingress",
    published: p.published,
    app_protocol: p.app_protocol,
  }));

  const volumes = service.volumes?.map((v) => {
    const out: SortableObject = {
      type: v.type,
      target: v.target,
      read_only: v.read_only,
    };
    if (v.source) out.source = v.source;
    return out;
  });

  return {
    image: service.image,
    hostname: service.hostname,
    command: service.command,
    entrypoint: service.entrypoint,
    environment: service.env,
    ports,
    volumes,
    networks: service.networks,
    healthcheck: service.healthcheck,
    depends_on: service.depends_on,
    deploy,
    labels: service.labels,
  };
}

export function toComposeYaml(file: StackFile): string {
  const services: SortableObject = {};
  for (const [name, service] of Object.entries(file.services)) {
    services[name] = prepareService(service);
  }

  const doc: SortableObject = {
    services,
    networks: file.networks,
    volumes: file.volumes,
    secrets: file.secrets,
    configs: file.configs,
  };

  return Bun.YAML.stringify(sortDeep(doc), null, 2);
}
