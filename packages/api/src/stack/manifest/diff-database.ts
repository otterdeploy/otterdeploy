import type { Change, CurrentDatabase, DiffOptions } from "./diff";
import type { FieldChanges } from "./diff-source";
/**
 * The database arm of the manifest diff.
 *
 * Split from ./diff.ts on the file-length cap, and it splits cleanly: every
 * rule here is about the ONE convention databases follow —
 * declared-only fields. An absent key means "the live editor owns this", never
 * "reset it to the default". Getting that wrong is what made a live
 * public-toggle (or a live env edit) come back staged as a revert seconds
 * later, which is the regression the tests in __tests__/diff.test.ts pin.
 */
import type { DatabaseManifest } from "./schema";

import { diffEnv, summarizeDatabase } from "./diff-helpers";

// ── Database diff ──────────────────────────────────────────────────────

export function diffDatabase(
  name: string,
  desired: DatabaseManifest,
  current: CurrentDatabase,
  opts: DiffOptions,
): Change[] {
  if (desired.engine !== current.engine) {
    return [
      { kind: "delete", resource: "database", name, details: { reason: "engine-changed" } },
      {
        kind: "create",
        resource: "database",
        name,
        details: { engine: desired.engine, ...summarizeDatabase(desired) },
      },
    ];
  }

  const fieldChanges: FieldChanges = {};
  // publicEnabled is manifest-managed only when the manifest declares it.
  // Omitted → the toggle is live-managed (same convention as service
  // publicEnabled, which diffServiceFields skips entirely); defaulting the
  // absent key to `false` here used to stage a phantom update that REVERTED
  // a live public-toggle on the next Apply.
  if (desired.publicEnabled !== undefined && desired.publicEnabled !== current.publicEnabled) {
    fieldChanges.publicEnabled = { from: current.publicEnabled, to: desired.publicEnabled };
  }

  // Same declared-only convention: `previews` opts the database into PR
  // branching; omitted leaves the live toggle alone.
  if (desired.previews !== undefined && desired.previews !== current.previewBranching) {
    fieldChanges.previews = { from: current.previewBranching, to: desired.previews };
  }

  // Where a database LIVES is create-time only. Re-homing it means copying its
  // data between servers, which an apply must never do as a side effect of a
  // one-line manifest edit — so the change is staged (the operator can see the
  // drift) and refused at apply with an explanation. Absent, as everywhere
  // else here, means "not manifest-managed", not "move it back".
  const desiredHost = "host" in desired ? (desired.host ?? null) : null;
  if (desiredHost !== null && desiredHost !== current.host) {
    fieldChanges.host = { from: current.host, to: desiredHost };
  }

  // Same declared-only convention as publicEnabled: an absent extraEnv means
  // the live env editor owns the keys. Diffing an absent map as `{}` used to
  // stage a phantom delete for every live-added key, and Apply wiped them
  // (rolling the container for good measure).
  const envChanges =
    desired.extraEnv === undefined
      ? []
      : diffEnv(desired.extraEnv, current.extraEnv, opts.resolveEnvValue);
  const out: Change[] = [];

  if (Object.keys(fieldChanges).length > 0) {
    out.push({
      kind: "update",
      resource: "database",
      name,
      details: { fields: fieldChanges },
    });
  }

  for (const change of envChanges) {
    out.push({
      kind: change.action,
      resource: "env",
      name: `${name}.${change.key}`,
      details: { ...change.details, parent: "database", key: change.key, owner: name },
    });
  }

  if (out.length === 0) {
    out.push({ kind: "no-op", resource: "database", name });
  }
  return out;
}
