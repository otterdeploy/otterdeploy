/**
 * Build the `lastAppliedManifest` snapshot from what an apply ACTUALLY landed,
 * rather than from what it was asked to do.
 *
 * The reconciler is deliberately partial: one bad resource does not abort the
 * run, it lands in `skipped[]` and the rest proceeds (see errors.ts). But the
 * snapshot was written as the whole submitted manifest regardless, so a
 * resource that failed to create was recorded as though it existed.
 *
 * That is not cosmetic, because of what discard means. Per its contract:
 * "Resets the saved manifest to the most recent successfully-applied snapshot.
 * After discard, manifest == current state." So a failed create baked into the
 * snapshot becomes permanent — the diff re-proposes it forever, Apply fails
 * forever (the name collides with whatever DID get created), and Discard
 * reverts TO the snapshot that contains it. The change can be neither applied
 * nor discarded, and the pending-changes bar never goes away.
 *
 * Observed in the wild: a database entry `mariadb-` sat in a project's resolved
 * manifest with no matching resource, next to the real `mariadb`. Apply died
 * with "Resource 'mariadb-' was created concurrently" (the sanitized name
 * collides with the existing row); Discard returned 200 and changed nothing.
 *
 * The rule below is one line of intent: a skipped resource reverts to whatever
 * the previous snapshot said about it. That happens to be correct for all three
 * verbs, which is why it isn't three rules:
 *
 *   - create skipped → absent from the previous snapshot → dropped. The
 *     resource does not exist, so the snapshot must not claim it does.
 *   - update skipped → previous spec restored. The resource still runs the old
 *     spec, so the next diff re-proposes the update instead of believing it.
 *   - delete skipped → previous entry restored. The resource is still there.
 */

import type { Manifest } from "../../stack/manifest";

/** The subset of a skip record this needs — matches ApplyResult["skipped"]. */
export interface SkippedResource {
  resource: "service" | "database" | "env" | "compose";
  name: string;
}

type Section = "services" | "databases" | "composes";

/**
 * Which manifest section a skip refers to. `env` is not a section of its own —
 * env changes belong to the service (or database) that declares them, so an
 * env failure reverts that resource's entry.
 */
function sectionsFor(resource: SkippedResource["resource"]): Section[] {
  switch (resource) {
    case "service":
      return ["services"];
    case "database":
      return ["databases"];
    case "compose":
      return ["composes"];
    // Try both: a service's `env` and a database's `extraEnv` both surface
    // here, and only one of them will hold the name.
    case "env":
      return ["services", "databases"];
  }
}

/** Shallow-clone only the sections we may touch; the rest is carried by ref. */
function cloneSections(manifest: Manifest): Manifest {
  return {
    ...manifest,
    services: { ...manifest.services },
    databases: { ...manifest.databases },
    composes: { ...manifest.composes },
  } as Manifest;
}

/**
 * The manifest to persist as `lastAppliedManifest`.
 *
 * `previous` is the snapshot before this apply — null on a project's first
 * apply, in which case a skipped create is simply dropped.
 */
export function snapshotAfterApply(args: {
  submitted: Manifest;
  previous: Manifest | null | undefined;
  skipped: readonly SkippedResource[];
}): Manifest {
  return revertEntries({
    target: args.submitted,
    source: args.previous,
    resources: args.skipped,
  });
}

/**
 * The manifest a discard should leave behind.
 *
 * Wholesale (no `only`): the manifest becomes the applied snapshot — the
 * original behaviour, "forget every staged edit". Selective: only the named
 * resources revert, so dropping one unwanted change keeps the rest staged.
 */
export function manifestAfterDiscard(args: {
  manifest: Manifest | null;
  applied: Manifest | null;
  only?: readonly SkippedResource[];
}): Manifest | null {
  if (!args.only?.length) return args.applied;
  return revertEntries({
    target: (args.manifest ?? args.applied ?? {}) as Manifest,
    source: args.applied,
    resources: args.only,
  });
}

/**
 * For each named resource, replace its entry in `target` with whatever `source`
 * says about it — deleting the entry when `source` doesn't mention it.
 *
 * Two callers want exactly this, which is why it is one function:
 *
 *   - {@link snapshotAfterApply}: revert the resources an apply skipped, so the
 *     persisted snapshot describes what actually landed.
 *   - selective discard: revert the resources the operator ticked off, so one
 *     unwanted change can be dropped without throwing away the rest of the
 *     pending edits (`discardManifest`'s `only`).
 *
 * In both cases `source` is the last successfully-applied manifest, i.e. the
 * deployed truth, and "revert" means "forget I proposed this".
 */
export function revertEntries(args: {
  target: Manifest;
  source: Manifest | null | undefined;
  resources: readonly SkippedResource[];
}): Manifest {
  if (args.resources.length === 0) return args.target;

  const next = cloneSections(args.target);

  for (const entry of args.resources) {
    for (const section of sectionsFor(entry.resource)) {
      const target = next[section] as Record<string, unknown> | undefined;
      if (!target) continue;

      const before = (args.source?.[section] as Record<string, unknown> | undefined)?.[entry.name];
      // Deliberately NOT guarded on the name already being in `target`: a
      // reverted DELETE is exactly the case where it isn't. The resource was
      // removed from the target manifest and the removal is what we're undoing,
      // so it has to come back from `source`. Absent on both sides is a no-op.
      if (before === undefined) delete target[entry.name];
      else target[entry.name] = before;
    }
  }

  return next;
}
