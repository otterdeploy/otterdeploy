/**
 * Build the picker's reference list for a project.
 *
 * Iterates every resource attached to the project + the (project,
 * environment) env bag, calls the same exporters the variable resolver
 * uses at deploy time, and projects each exported key into the
 * `AvailableReference` shape consumed by the wizard's "Add Reference"
 * dropdown.
 *
 * Secrets are masked here — the picker only needs to render the key
 * name and the source label. The actual value lands in the consumer
 * service's container at deploy time via the resolver; the picker is
 * a discovery surface, not a viewer.
 */
import type { OrganizationId, ProjectId } from "@otterdeploy/shared/id";

import { Result } from "better-result";

import { listProxyRoutesByResourceId } from "../../caddy/queries";
import { postgresExports, serviceExports } from "../../lib/variables/exporters";
import { listServiceEnvVars, listServicePorts } from "../service/queries";
import { ProjectNotFoundError } from "./errors";
import { getProjectInOrg, getProjectRecord, loadProjectEnvBag } from "./queries";
import { listProjectResources } from "./queries/resource";

type OrgId = OrganizationId;
type DatabaseEngine = "postgres" | "redis" | "mariadb" | "mongodb";

export interface AvailableReference {
  sourceKind: "database" | "service" | "project" | "environment";
  sourceName: string;
  engine: DatabaseEngine | null;
  key: string;
  token: string;
  isSecret: boolean;
}

interface Input {
  projectId: ProjectId;
  organizationId: OrgId;
}

/** Keys whose value should be masked in any UI rendering. */
const SECRET_KEY_PATTERNS: RegExp[] = [
  /PASSWORD/i,
  /SECRET/i,
  /TOKEN/i,
  /KEY$/i,
  /CONNECTION_STRING/i,
  /_URL$/i, // connection URLs typically embed credentials
];

function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERNS.some((re) => re.test(key));
}

function projectEngineFor(engine: string): DatabaseEngine {
  // Schema enum guarantees one of these — explicit cast keeps the
  // discriminated UI types narrow at the call site.
  return engine as DatabaseEngine;
}

export async function listAvailableRefs(
  input: Input,
): Promise<Result<AvailableReference[], ProjectNotFoundError>> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  }

  const refs: AvailableReference[] = [];
  const { databases, services } = await listProjectResources(input.projectId);

  // ── Database resources: postgres exporter today; redis/mariadb/mongo
  // pick up their own exporter when we wire them. The exporter contract
  // is engine-agnostic (Record<string,string>) so the picker doesn't
  // change shape per engine — just the set of keys it sees.
  for (const row of databases) {
    const engine = projectEngineFor(row.database.engine);
    const exported = postgresExports({
      resource: row.resource,
      database: {
        internalConnectionString: row.database.internalConnectionString,
        internalHostname: row.database.internalHostname,
        internalPort: row.database.internalPort,
        username: row.database.username,
        password: row.database.password,
        databaseName: row.database.databaseName,
      },
    });
    for (const key of Object.keys(exported)) {
      refs.push({
        sourceKind: "database",
        sourceName: row.resource.name,
        engine,
        key,
        token: `\${{${row.resource.name}.${key}}}`,
        isSecret: isSecretKey(key),
      });
    }
  }

  // ── Service resources: HOST/PORT/URL + every defined env key. We
  // don't resolve cross-service refs here — the picker shows the
  // service's OWN env keys (post-resolution at deploy time those are
  // what consumers see), which is enough for the dropdown's purpose.
  for (const row of services) {
    const [env, ports, routes] = await Promise.all([
      listServiceEnvVars(row.service.resourceId),
      listServicePorts(row.service.resourceId),
      listProxyRoutesByResourceId(row.service.resourceId),
    ]);
    const exported = serviceExports({
      resource: row.resource,
      service: row.service,
      ports,
      resolvedEnv: Object.fromEntries(env.map((e) => [e.key, e.value])),
      domains: routes.map((r) => r.domain),
    });
    for (const key of Object.keys(exported)) {
      refs.push({
        sourceKind: "service",
        sourceName: row.resource.name,
        engine: null,
        key,
        token: `\${{${row.resource.name}.${key}}}`,
        isSecret: isSecretKey(key),
      });
    }
  }

  // ── Shared (project / environment) variables. Both magic scopes back the
  // SAME (project, environment) bag today, so emitting one ref per key under
  // each scope produced a confusing duplicate list (S3_BUCKET·project +
  // S3_BUCKET·environment, identical value). Collapse to ONE entry per key,
  // tokenized under the project scope — the broader scope that resolves in
  // every environment. (When env-specific overrides become a distinct bag,
  // emit the environment variant only for keys whose value actually differs.)
  const projectRecord = await getProjectRecord(input.projectId);
  if (projectRecord?.environmentId) {
    const bag = await loadProjectEnvBag({
      projectId: input.projectId,
      environmentId: projectRecord.environmentId,
    });
    for (const key of Object.keys(bag)) {
      refs.push({
        sourceKind: "project",
        sourceName: "Shared variables",
        engine: null,
        key,
        token: `\${{project.${key}}}`,
        isSecret: isSecretKey(key),
      });
    }
  }

  return Result.ok(refs);
}
