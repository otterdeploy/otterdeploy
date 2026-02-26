import { Result } from "better-result";
import crypto from "node:crypto";
import { createId } from "@otterdeploy/utils";

import type { ResolvedEnvVar } from "./env-resolver";

export interface SnapshotEntry {
  key: string;
  variableId: string;
  scope: "project" | "environment" | "resource";
  secretReferenceId: string | null;
  providerVersion: string | null;
  digest: string;
}

export interface CreateSnapshotDeps {
  insertSnapshot: (snapshot: {
    id: string;
    deploymentId: string;
    organizationId: string;
    resourceId: string;
    entriesJson: SnapshotEntry[];
    snapshotHash: string;
  }) => Promise<void>;
}

/**
 * Create snapshot entries from resolved env vars, computing SHA-256 digests of each value.
 */
export function createSnapshotEntries(vars: ResolvedEnvVar[]): SnapshotEntry[] {
  return vars.map((v) => ({
    key: v.key,
    variableId: v.variableId,
    scope: v.scope,
    secretReferenceId: null,
    providerVersion: null,
    digest: crypto.createHash("sha256").update(v.value).digest("hex"),
  }));
}

/**
 * Compute a deterministic hash for a set of snapshot entries.
 * Entries are sorted by key before hashing.
 */
export function computeSnapshotHash(entries: SnapshotEntry[]): string {
  const sorted = [...entries].sort((a, b) => a.key.localeCompare(b.key));
  return crypto.createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}

/**
 * Create a deployment snapshot containing digests of all resolved env vars.
 */
export async function createDeploymentSnapshot(
  deploymentId: string,
  organizationId: string,
  resourceId: string,
  resolvedVars: ResolvedEnvVar[],
  deps: CreateSnapshotDeps,
): Promise<Result<{ snapshotHash: string }, Error>> {
  try {
    const entries = createSnapshotEntries(resolvedVars);
    const snapshotHash = computeSnapshotHash(entries);

    await deps.insertSnapshot({
      id: createId(),
      deploymentId,
      organizationId,
      resourceId,
      entriesJson: entries,
      snapshotHash,
    });

    return Result.ok({ snapshotHash });
  } catch (err) {
    return Result.err(err instanceof Error ? err : new Error(String(err)));
  }
}
