/**
 * Typed refusals for a database password rotation, and the
 * up-front check that decides whether a database can be rotated at all.
 */
import type { ResourceId } from "@otterdeploy/shared/id";

import { Result, TaggedError } from "better-result";

import type { DatabaseResourceRecord } from "../queries";

import {
  isRotatableEngine,
  type RotatableEngine,
} from "../../../swarm/database-engines/password-rotation";

/** The database cannot be rotated in place; nothing was changed. */
export class PasswordRotationUnsupportedError extends TaggedError(
  "PasswordRotationUnsupportedError",
)<{
  message: string;
  resourceId: ResourceId;
}>() {
  constructor(args: { resourceId: ResourceId; reason: string }) {
    super({ resourceId: args.resourceId, message: args.reason });
  }
}

/** The engine refused (or could not be reached for) the change. The row and
 *  every variable were rolled back with it, so the old password still works. */
export class PasswordRotationFailedError extends TaggedError("PasswordRotationFailedError")<{
  message: string;
  resourceId: ResourceId;
}>() {
  constructor(args: { resourceId: ResourceId; reason: string }) {
    super({
      resourceId: args.resourceId,
      message: `password not rotated: ${args.reason}`,
    });
  }
}

/** Why a deployed-ness or preview rule forbids rotating `record`, or null. */
function lifecycleRefusal(record: DatabaseResourceRecord): string | null {
  if (record.resource.status === "draft") {
    return "this database has not been deployed yet, so it has no password to rotate";
  }
  if (record.resource.previewId !== null) {
    return "a preview's database branch is recreated from its base; rotate the base database";
  }
  return null;
}

/** The engine to rotate, or why `record` cannot be rotated at all. */
export function rotationTarget(
  record: DatabaseResourceRecord,
): Result<RotatableEngine, PasswordRotationUnsupportedError> {
  const engine = record.database.engine;
  const refusal = lifecycleRefusal(record);
  if (refusal !== null || !isRotatableEngine(engine)) {
    return Result.err(
      new PasswordRotationUnsupportedError({
        resourceId: record.resource.id,
        reason: refusal ?? `${engine} passwords cannot be rotated in place yet`,
      }),
    );
  }
  return Result.ok(engine);
}
