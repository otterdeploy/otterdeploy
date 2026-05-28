/**
 * Emit compose-compatible YAML from a StackFile.
 *
 * The `x-otterdeploy` extension block on each service is also projected
 * into compose `deploy.labels` (`otterdeploy.kind`, `otterdeploy.engine`,
 * `otterdeploy.resource.id`, `otterdeploy.project.id`) so tools that only
 * see the compose subset can still identify the owner without parsing
 * extension keys.
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

// Compose labels carry the *queryable* identity bits — fields a Docker
// operator can filter by (`docker service ls --filter
// label=otterdeploy.project.id=…`). Everything else (publicEnabled,
// publicHostname, preDeploy, buildConfig, etc.) lives in the
// `x-otterdeploy` extension block, with native types and the same
// camelCase shape as the rest of the codebase. Don't duplicate fields
// between the two — pick one home per field.
function extensionLabels(
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
  const labels = extensionLabels(service["x-otterdeploy"]);
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
    // Inline file content stays under the otterdeploy extension key so
    // compose-only consumers ignore it.
    if (v.x_otterdeploy_content !== undefined) {
      out["x-otterdeploy-content"] = v.x_otterdeploy_content;
    }
    return out;
  });

  // Compose `environment` is a string-string map (we model `env` that
  // way too). Rename on emit.
  const environment = service.env;

  return {
    image: service.image,
    hostname: service.hostname,
    command: service.command,
    entrypoint: service.entrypoint,
    environment,
    ports,
    volumes,
    networks: service.networks,
    healthcheck: service.healthcheck,
    depends_on: service.depends_on,
    deploy,
    labels: service.labels,
    "x-otterdeploy": service["x-otterdeploy"],
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
    "x-otterdeploy-version": file.version,
  };

  return Bun.YAML.stringify(sortDeep(doc), null, 2);
}
