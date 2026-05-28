/**
 * Available variable references — drives the "Add Reference" picker
 * and the inline `${{` autocomplete in the env-var editor.
 *
 * One row per `${{Source.KEY}}` token that resolves in a given project.
 * Source can be another resource in the project (database / service),
 * the project-wide env bag, or the environment-wide bag. Values are
 * masked in the response so the picker can show secrets without
 * leaking them through casual screenshare.
 */

import { oc } from "@orpc/contract";
import * as z from "zod";

import { basePath, projectNotFoundErrors, tag } from "./shared";
import { projectIdField } from "./shared";

export const availableReferenceSchema = z.object({
  /** What produces this reference. Drives the icon/label in the
   *  picker — UI keeps a small switch on this field. */
  sourceKind: z.enum(["database", "service", "project", "environment"]),
  /** Display label for the source. For resources it's the resource's
   *  `name`; for project/environment scopes it's a fixed label. */
  sourceName: z.string(),
  /** Engine for database sources (drives the brand icon). Null for
   *  non-database sources. */
  engine: z.enum(["postgres", "redis", "mariadb", "mongodb"]).nullable(),
  /** The exported key name (e.g. `DATABASE_URL`, `PGHOST`). */
  key: z.string(),
  /** The full reference token to insert into a value field. */
  token: z.string(),
  /** Whether the underlying value is sensitive. Picker masks the
   *  rendered sample for secret rows. */
  isSecret: z.boolean(),
});

export const listAvailableRefsInput = z.object({
  projectId: projectIdField,
});

export const refsContractSlice = {
  list: oc
    .errors(projectNotFoundErrors)
    .meta({
      path: `${basePath}/{projectId}/refs`,
      tag,
      method: "GET",
    })
    .input(listAvailableRefsInput)
    .output(z.array(availableReferenceSchema)),
};
