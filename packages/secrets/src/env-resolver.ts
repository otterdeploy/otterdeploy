import { Result } from "better-result";

export interface ResolvedEnvVar {
  key: string;
  value: string;
  scope: "project" | "environment" | "resource";
  scopeId: string;
  isBuildTime: boolean;
  isSecret: boolean;
  variableId: string;
}

export interface EnvVarRow {
  id: string;
  key: string;
  encryptedValue: string;
  secretReferenceId: string | null;
  scope: "project" | "environment" | "resource";
  scopeId: string;
  isBuildTime: boolean;
  isSecret: boolean;
}

export interface EnvResolverDeps {
  getProjectVars: (projectId: string) => Promise<EnvVarRow[]>;
  getEnvironmentVars: (environmentId: string) => Promise<EnvVarRow[]>;
  getResourceVars: (resourceId: string) => Promise<EnvVarRow[]>;
  decryptValue: (encryptedValue: string) => string;
  revealSecret?: (secretReferenceId: string) => Promise<string>;
}

/**
 * Resolve env vars for a resource across all scopes.
 * Resolution order: project -> environment -> resource (later overrides earlier, same key).
 */
export async function resolveEnvVars(
  resourceId: string,
  environmentId: string,
  projectId: string,
  deps: EnvResolverDeps,
): Promise<Result<ResolvedEnvVar[], Error>> {
  try {
    const [projectVars, envVars, resourceVars] = await Promise.all([
      deps.getProjectVars(projectId),
      deps.getEnvironmentVars(environmentId),
      deps.getResourceVars(resourceId),
    ]);

    const merged = new Map<string, EnvVarRow>();

    for (const v of projectVars) {
      merged.set(v.key, v);
    }
    for (const v of envVars) {
      merged.set(v.key, v);
    }
    for (const v of resourceVars) {
      merged.set(v.key, v);
    }

    const resolved: ResolvedEnvVar[] = [];

    for (const row of merged.values()) {
      let value: string;

      if (row.secretReferenceId && deps.revealSecret) {
        value = await deps.revealSecret(row.secretReferenceId);
      } else {
        value = deps.decryptValue(row.encryptedValue);
      }

      resolved.push({
        key: row.key,
        value,
        scope: row.scope,
        scopeId: row.scopeId,
        isBuildTime: row.isBuildTime,
        isSecret: row.isSecret,
        variableId: row.id,
      });
    }

    return Result.ok(resolved);
  } catch (err) {
    return Result.err(err instanceof Error ? err : new Error(String(err)));
  }
}
