/**
 * Cross-file evidence, sourced from fallow.
 *
 * Cycles, clone groups and dead-code findings are properties of the module
 * graph, not of any single file, so they cannot come from the per-file regex
 * pass. fallow already computes them; this just reshapes its JSON into
 * per-file lookups.
 */

import { fallowJson } from "./fallow";

export interface CrossFileEvidence {
  /** Files participating in at least one import cycle. */
  cycles: Set<string>;
  /** file → number of distinct clone groups it belongs to. */
  clones: Map<string, number>;
  /** file → number of dead-code findings against it. */
  dead: Map<string, number>;
}

const DEAD_CODE_KEYS = [
  "unused_types",
  "unused_exports",
  "unused_files",
  "unused_class_members",
] as const;

/** Run one fallow analysis, warning rather than aborting when it cannot run. */
function analysis(command: string, cwd: string): Record<string, unknown> | null {
  const parsed = fallowJson([command], cwd);
  if (!parsed) console.warn(`  ! fallow ${command} unavailable. Cross-file signals skipped`);
  return parsed;
}

function parseDeadCode(dc: Record<string, unknown>, out: CrossFileEvidence): void {
  for (const cycle of (dc.circular_dependencies as { files?: string[] }[]) ?? []) {
    for (const f of cycle.files ?? []) out.cycles.add(f);
  }
  for (const key of DEAD_CODE_KEYS) {
    for (const item of (dc[key] as { path?: string }[]) ?? []) {
      if (item.path) out.dead.set(item.path, (out.dead.get(item.path) ?? 0) + 1);
    }
  }
}

function parseDupes(dup: Record<string, unknown>, out: CrossFileEvidence): void {
  for (const group of (dup.clone_groups as { instances?: { file?: string }[] }[]) ?? []) {
    // Count each group once per file, not once per instance. A file with one
    // block cloned five times has ONE consolidation decision to make.
    const seen = new Set<string>();
    for (const inst of group.instances ?? []) {
      if (inst.file) seen.add(inst.file);
    }
    for (const f of seen) out.clones.set(f, (out.clones.get(f) ?? 0) + 1);
  }
}

export function collectEvidence(cwd: string): CrossFileEvidence {
  const out: CrossFileEvidence = { cycles: new Set(), clones: new Map(), dead: new Map() };
  const dc = analysis("dead-code", cwd);
  if (dc) parseDeadCode(dc, out);
  const dup = analysis("dupes", cwd);
  if (dup) parseDupes(dup, out);
  return out;
}
