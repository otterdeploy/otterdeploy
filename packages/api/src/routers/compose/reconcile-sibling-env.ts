import type { ResourceId } from "@otterdeploy/shared/id";
/**
 * Repoint a freshly seeded child's env at the siblings it meant (od-tahh).
 *
 * Runs after every row in the stack exists, because the rename map is not
 * knowable before then: `pickInternalHostname` decides each hostname against
 * the DB as it goes, so the answer for `db` depends on what has already been
 * inserted.
 *
 * Only CREATED children are rewritten. Their env was seeded from the compose
 * file moments ago, which is exactly the "rewrite seeded env values through the
 * rename map at materialize time" this is for — and it is the line that keeps
 * the pass off any value a human has since edited. env is user-owned after
 * create everywhere else in this reconcile; that stays true here.
 *
 * Best-effort per row: a stack coming up with one un-rewritten variable beats
 * a reconcile that aborts, and the caller logs what changed.
 */
import type { RequestLogger } from "evlog";

import { Result } from "better-result";

import { listServiceEnvVars, upsertServiceEnvVar } from "../service/queries";
import { rewriteSiblingHosts, siblingRenames } from "./sibling-hosts";

export interface SeededChild {
  composeService: string;
  internalHostname: string;
  resourceId: ResourceId;
  isCreate: boolean;
}

/**
 * Rewrite sibling host references in the seeded env of every newly created
 * child. Returns the number of values changed, for the deploy log.
 */
export async function rewriteSeededSiblingHosts(
  children: readonly SeededChild[],
  log?: RequestLogger,
): Promise<number> {
  const renames = siblingRenames(children);
  if (renames.size === 0) return 0;

  let changed = 0;
  for (const child of children) {
    if (!child.isCreate) continue;
    const listed = await Result.tryPromise({
      try: () => listServiceEnvVars(child.resourceId),
      catch: (e: unknown) => e,
    });
    if (listed.isErr()) continue;

    for (const row of listed.value) {
      // A sealed row holds a ciphertext envelope, not a URL. Nothing to match,
      // and rewriting one would destroy it.
      if (row.sealed) continue;
      const next = rewriteSiblingHosts(row.key, row.value, renames);
      if (next === row.value) continue;
      const written = await Result.tryPromise({
        try: () =>
          upsertServiceEnvVar({
            serviceResourceId: child.resourceId,
            key: row.key,
            value: next,
            // Deliberately no `source`: this repoints a value the compose file
            // seeded, it does not claim authorship. Omitting it leaves the
            // row's existing provenance intact (see upsertServiceEnvVar).
          }),
        catch: (e: unknown) => e,
      });
      if (written.isOk()) changed += 1;
    }
  }

  if (changed > 0) {
    log?.set({
      compose: {
        step: "rewrite-sibling-hosts",
        renamed: [...renames.keys()],
        values: changed,
      },
    });
  }
  return changed;
}
