/**
 * Build the picker's reference list for a project.
 *
 * Iterates every resource attached to the project + the (project,
 * environment) env bag, calls the same exporters the variable resolver
 * uses at deploy time, and projects each exported key into the
 * `AvailableReference` shape consumed by the wizard's "Add Reference"
 * dropdown.
 *
 * Secrets are masked here. The picker only needs to render the key
 * name and the source label. The actual value lands in the consumer
 * service's container at deploy time via the resolver; the picker is
 * a discovery surface, not a viewer.
 */
import type { EnvironmentId, OrganizationId, ProjectId } from "@otterdeploy/shared/id";

import { Result } from "better-result";
import * as z from "zod";

import { listProxyRoutesByResourceId } from "../../caddy/queries";
import { decryptForDomain } from "../../lib/crypto";
import { postgresExports, serviceExports } from "../../lib/variables/exporters";
import { listSecretNames } from "../../lib/vault";
import { listServiceEnvVars, listServicePorts } from "../service/queries";
import { listVaultProvidersByOrg } from "../vault-provider/queries";
import { ProjectNotFoundError } from "./errors";
import {
  getProjectInOrg,
  getProjectRecord,
  loadProjectEnvBag,
  resolveEnvironmentScope,
} from "./queries";
import { listProjectResources } from "./queries/resource";

type OrgId = OrganizationId;

/** Engines the picker's contract knows how to badge (see the `engine` enum in
 *  ./contract/refs.ts). Kept as a schema so the DB value is narrowed, not cast. */
const refEngineSchema = z.enum(["postgres", "redis", "mariadb", "mongodb"]);
type DatabaseEngine = z.infer<typeof refEngineSchema>;

export interface AvailableReference {
  sourceKind: "database" | "service" | "project" | "environment" | "vault";
  sourceName: string;
  engine: DatabaseEngine | null;
  /** Provider kind for vault sources: the picker's brand icon, same role
   *  as `engine` for databases. */
  vaultKind: "hashicorp" | "infisical" | "doppler" | null;
  key: string;
  token: string;
  isSecret: boolean;
  /** Platform-generated export (HOST/PORT/URL/DOMAIN/DATABASE_URL/…) vs a
   *  user-defined variable. Drives the "platform" tag in the picker. */
  platform: boolean;
}

interface Input {
  projectId: ProjectId;
  organizationId: OrgId;
  /** Environment whose resources may be referenced. Omitted means main. */
  environmentId?: EnvironmentId;
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

function projectEngineFor(engine: string): DatabaseEngine | null {
  // Narrow the DB enum value against the contract's engine set. An engine the
  // contract doesn't know (e.g. clickhouse) degrades to null (no brand icon)
  // instead of failing the whole response's output validation.
  const parsed = refEngineSchema.safeParse(engine);
  return parsed.success ? parsed.data : null;
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
  // Reference pickers offer what the CURRENT environment can actually reach:
  // a staging service must not be offered production's database as a source.
  const scope = resolveEnvironmentScope(project, input.environmentId);
  const { databases, services, composes } = scope
    ? await listProjectResources(input.projectId, scope)
    : { databases: [], services: [], composes: [] };
  // Stack names, for addressing a stack's children by compose service key
  // instead of by their (fallback-suffixed, rename-prone) resource name.
  const stackNameById = new Map(composes.map((c) => [c.resource.id, c.resource.name] as const));

  // ── Database resources: postgres exporter today; redis/mariadb/mongo
  // pick up their own exporter when we wire them. The exporter contract
  // is engine-agnostic (Record<string,string>) so the picker doesn't
  // change shape per engine. Just the set of keys it sees.
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
        vaultKind: null,
        key,
        token: `\${{${row.resource.name}.${key}}}`,
        isSecret: isSecretKey(key),
        // Every database export (DATABASE_URL, PG*, …) is platform-generated.
        platform: true,
      });
    }
  }

  // ── Service resources: HOST/PORT/URL + every defined env key. We
  // don't resolve cross-service refs here. The picker shows the
  // service's OWN env keys (post-resolution at deploy time those are
  // what consumers see), which is enough for the dropdown's purpose.
  for (const row of services) {
    const [env, ports, routes] = await Promise.all([
      listServiceEnvVars(row.service.resourceId),
      listServicePorts(row.service.resourceId),
      listProxyRoutesByResourceId(row.service.resourceId),
    ]);
    // User-defined keys come from the service's own env bag; everything else
    // serviceExports adds (HOST/PORT/URL/DOMAIN/PUBLIC_URL/DOMAINS) is platform.
    const userKeys = new Set(env.map((e) => e.key));
    // A stack child gets the stack-scoped addressing (`${{autumn.db.HOST}}`):
    // the compose key is stable where the child's resource name is not — a
    // second instance of the same template renames the resource (`autumn-db-2`)
    // and would silently strand every token the picker had handed out. Falls
    // back to the flat form for children predating `compose_service`, which
    // heal on their stack's next reconcile.
    const stackName = row.service.stackId ? stackNameById.get(row.service.stackId) : undefined;
    const source =
      stackName && row.service.composeService
        ? `${stackName}.${row.service.composeService}`
        : row.resource.name;
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
        vaultKind: null,
        key,
        token: `\${{${source}.${key}}}`,
        isSecret: isSecretKey(key),
        platform: !userKeys.has(key),
      });
    }
  }

  // ── Shared (project / environment) variables. Both magic scopes back the
  // SAME (project, environment) bag today, so emitting one ref per key under
  // each scope produced a confusing duplicate list (S3_BUCKET·project +
  // S3_BUCKET·environment, identical value). Collapse to ONE entry per key,
  // tokenized under the project scope. The broader scope that resolves in
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
        vaultKind: null,
        key,
        token: `\${{project.${key}}}`,
        isSecret: isSecretKey(key),
        // Operator-defined shared vars, never platform-generated.
        platform: false,
      });
    }
  }

  // ── External secret managers. One group per configured provider, keys
  // from a best-effort listing (empty on any provider error: the picker
  // degrades to free-text `${{vault.<provider>.<ref>}}` refs). Values never
  // travel here: a vault ref is always a secret and only resolves at deploy.
  refs.push(...(await listVaultRefs(input.organizationId)));

  return Result.ok(refs);
}

async function listVaultRefs(organizationId: OrgId): Promise<AvailableReference[]> {
  const refs: AvailableReference[] = [];
  for (const provider of await listVaultProvidersByOrg(organizationId)) {
    let names: string[] = [];
    try {
      const credential = await decryptForDomain(provider.credentialCiphertext, "vault-creds");
      names = await listSecretNames({
        name: provider.name,
        kind: provider.kind,
        config: provider.configJson,
        credential,
      });
    } catch {
      // Best-effort by contract: an unreachable provider lists nothing.
      names = [];
    }
    for (const key of names) {
      refs.push({
        sourceKind: "vault",
        sourceName: provider.name,
        engine: null,
        vaultKind: provider.kind,
        key,
        token: `\${{vault.${provider.name}.${key}}}`,
        // Externally-managed secret material, always masked.
        isSecret: true,
        platform: false,
      });
    }
  }
  return refs;
}
