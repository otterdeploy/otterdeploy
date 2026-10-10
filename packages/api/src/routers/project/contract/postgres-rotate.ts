/**
 * `project.resource.database.postgres.rotatePassword`, split out
 * of ./postgres so that file stays under its line cap.
 */
import { oc } from "@orpc/contract";
import * as z from "zod";

import { basePath, projectIdField, resourceIdField, resourceNotFoundErrors, tag } from "./shared";

const rotatePasswordInput = z.object({
  projectId: projectIdField,
  resourceId: resourceIdField,
  /** Postgres: end the sessions that opened before the change (they
   *  authenticated with the old password). Default true. */
  terminateSessions: z.boolean().optional().default(true),
});

const rotatePasswordOutput = z.object({
  resourceId: z.string(),
  engine: z.string(),
  rotatedAt: z.string(),
  /** Every service rolled onto the new password, in roll order. */
  dependents: z.array(
    z.object({
      resourceId: z.string(),
      name: z.string(),
      status: z.string(),
      error: z.string().nullable(),
    }),
  ),
  /** Stored variables that held the old password verbatim, now rewritten. */
  rewrittenVariables: z.number().int(),
  /** Sessions ended for authenticating with the old password; null when not
   *  attempted. */
  terminatedSessions: z.number().int().nullable(),
});

// Rotate the database's password on the engine, then roll every service
// that connects with it. The new password is not in the
// response: read it from the resource like any other credential.
export const rotatePasswordContract = oc
  .errors({
    ...resourceNotFoundErrors,
    ROTATION_UNSUPPORTED: {
      status: 422 as const,
      message: "This database's password can't be rotated" as const,
    },
    ROTATION_FAILED: {
      status: 409 as const,
      message: "The database refused the new password; nothing was changed" as const,
    },
  })
  .meta({
    path: `${basePath}/{projectId}/resources/database/postgres/{resourceId}/rotate-password`,
    tag,
    method: "POST",
  })
  .input(rotatePasswordInput)
  .output(rotatePasswordOutput);
