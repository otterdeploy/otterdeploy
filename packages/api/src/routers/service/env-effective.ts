/**
 * A service's env as the container will actually see it: `${{…}}` references
 * expanded, one row per key.
 *
 * The declared rows say `postgres://…@${{stack.db.HOST}}:5432/x`. That is the
 * thing you edit, and the wrong thing to debug with — "is this pointing at the
 * right database" is a question about the RESOLVED value. Only the preview
 * panel could answer it (`listPreviewEffectiveEnv`); the base service had no
 * endpoint at all, so the editor showed the template and left the reader to
 * run the substitution in their head.
 *
 * MASKING IS NOT OPTIONAL HERE. `resolveServiceEnv` decrypts sealed rows and
 * fetches vault values, because the deploy path needs the real thing. This is
 * a READ endpoint for a browser, so a secret's resolved value can never leave:
 * a masked row still answers "is it set" and "did the reference resolve",
 * which is what the surface is for.
 */
import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { Result } from "better-result";

import type { ProjectNotFoundError } from "../project/errors";
import type { ServiceNotFoundError } from "./errors";

import { resolveServiceEnv } from "../../lib/variables/resolver";
import { loadResource } from "./context";
import { listServiceEnvVars } from "./queries";

/** Same glyph run the preview panel masks with, so one idea has one look. */
const SECRET_MASK = "••••••••";

export interface EffectiveEnvRow {
  key: string;
  /** Resolved, or the raw declared value when the resolver failed. Masked
   *  whenever the row is secret or sealed. */
  value: string;
  /** The value as written, references and all. Masked on the same terms.
   *  Null when it is identical to `value` — nothing to compare. */
  declared: string | null;
  isSecret: boolean;
  sealed: boolean;
  /** The resolver could not produce this key: a missing reference, a cycle, a
   *  vault outage. The row still lists, because a variable that failed to
   *  resolve is exactly the one you opened this to find. */
  unresolved: boolean;
}

export async function listEffectiveEnv(input: {
  projectId: ProjectId;
  resourceId: ResourceId;
  organizationId: Parameters<typeof loadResource>[0]["organizationId"];
}): Promise<Result<EffectiveEnvRow[], ProjectNotFoundError | ServiceNotFoundError>> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);

  const declaredRows = await listServiceEnvVars(input.resourceId);
  // Base scope (previewId null): this is the production view.
  const resolved = await resolveServiceEnv(input.projectId, input.resourceId, null);
  const resolvedByKey = resolved.isOk() ? resolved.value : {};
  const resolveOk = resolved.isOk();

  return Result.ok(
    declaredRows
      .map((row) => {
        const hidden = row.isSecret || row.sealed;
        const resolvedValue = resolvedByKey[row.key];
        // On resolver failure fall back to what was declared, so the tab never
        // blanks out over one bad reference elsewhere in the bag.
        const effective = resolvedValue ?? row.value;
        const declared = row.value === effective ? null : row.value;
        return {
          key: row.key,
          value: hidden && effective.length > 0 ? SECRET_MASK : effective,
          declared: declared === null ? null : hidden ? SECRET_MASK : declared,
          isSecret: row.isSecret,
          sealed: row.sealed,
          unresolved: !resolveOk && resolvedValue === undefined,
        };
      })
      .sort((a, b) => a.key.localeCompare(b.key)),
  );
}
