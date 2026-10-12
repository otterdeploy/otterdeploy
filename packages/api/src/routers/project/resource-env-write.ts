/**
 * The two halves of the Variables tab's whole-set env write
 * (bulkSetResourceEnv in resource-runtime.ts), split out for size. A write
 * that names the version of the set its editor loaded is refused with
 * EnvVersionConflictError when the set changed since.
 */
import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { Result } from "better-result";

import type { EnvVersionConflictError } from "../service/env-version-error";
import type { RefSelfReferenceError } from "../service/errors";
import type { EnvEntry } from "./resource-runtime";

import { rejectSelfReferences } from "../service/env-self-ref";
import { bulkReplaceServiceEnvVarsAt } from "../service/queries";
import { setDatabaseResourceExtraEnv, setDatabaseResourceExtraEnvAt } from "./queries";

type ServiceRecordOf = Parameters<typeof rejectSelfReferences>[1];

/** A database's env write: versioned when the caller named the version it
 *  loaded, unconditional otherwise. */
export async function writeDatabaseEnv(
  resourceId: ResourceId,
  next: Record<string, string>,
  secretKeys: string[] | undefined,
  expectedVersion: string | undefined,
): Promise<Result<void, EnvVersionConflictError>> {
  if (expectedVersion === undefined) {
    await setDatabaseResourceExtraEnv(resourceId, next, secretKeys);
    return Result.ok(undefined);
  }
  return setDatabaseResourceExtraEnvAt(resourceId, next, secretKeys, expectedVersion);
}

/** A service's env write: refuse a self-reference, then replace the base set
 *  (versioned when the caller named the version it loaded). */
export async function writeServiceEnv(
  input: {
    projectId: ProjectId;
    resourceId: ResourceId;
    env: EnvEntry[];
    secretKeys?: string[];
    expectedVersion?: string;
  },
  record: ServiceRecordOf,
): Promise<Result<void, RefSelfReferenceError | EnvVersionConflictError>> {
  // A value that reads this service's own env bag can never resolve. Refuse
  // it here, where the answer reaches the Variables tab as the save's error,
  // instead of persisting it and failing the next redeploy with a cycle.
  const guarded = await rejectSelfReferences(input.projectId, record, input.env);
  if (guarded.isErr()) return Result.err(guarded.error);
  const secretSet = new Set(input.secretKeys ?? []);
  const replaced = await bulkReplaceServiceEnvVarsAt(
    input.resourceId,
    input.env.map((e) => ({ ...e, isSecret: secretSet.has(e.key) })),
    // The Variables tab. A human sent the whole bag, so these are theirs.
    "ui",
    input.expectedVersion,
  );
  return replaced.isErr() ? Result.err(replaced.error) : Result.ok(undefined);
}
