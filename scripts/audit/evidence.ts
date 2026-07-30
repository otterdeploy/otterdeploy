/**
 * Cross-file evidence, sourced from fallow.
 *
 * Cycles, clone groups and dead-code findings are properties of the module
 * graph, not of any single file, so they cannot come from the per-file regex
 * pass. fallow already computes them; this just reshapes its JSON into
 * per-file lookups.
 */

import { execFileSync } from "node:child_process";

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

/** Run one fallow analysis and parse its JSON, or null if unavailable. */
function fallowJson(command: string, cwd: string): Record<string, unknown> | null {
  const read = (raw: string): Record<string, unknown> | null => {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  try {
    return read(
      execFileSync("bunx", ["fallow", command, "--format", "json", "--quiet"], {
        cwd,
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
  } catch (err) {
    // fallow exits non-zero whenever it finds issues, which is the normal
    // case — its stdout is still the report we want.
    const stdout = (err as { stdout?: string }).stdout;
    const parsed = stdout ? read(stdout) : null;
    if (!parsed) console.warn(`  ! fallow ${command} unavailable — cross-file signals skipped`);
    return parsed;
  }
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
    // Count each group once per file, not once per instance — a file with one
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
  const dc = fallowJson("dead-code", cwd);
  if (dc) parseDeadCode(dc, out);
  const dup = fallowJson("dupes", cwd);
  if (dup) parseDupes(dup, out);
  return out;
}
