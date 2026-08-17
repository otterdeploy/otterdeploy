/**
 * Turns raw signals into flags and a review tier.
 *
 * One function per rubric axis, so the code and docs/audit/RUBRIC.md stay
 * legible against each other. A flag never means "this is wrong". It means
 * "a human should look here, and this is what to look at".
 */

import type { Signals } from "./detectors";
import type { CrossFileEvidence } from "./evidence";

import { countSignals, HIGH_STAKES } from "./detectors";

export interface FileSheet {
  path: string;
  lines: number;
  tier: 0 | 1 | 2 | 3;
  highStakes: boolean;
  signals: Signals;
  flags: string[];
  inCycle: boolean;
  cloneGroups: number;
  deadCode: number;
}

/**
 * Axis 2: the largest finding in the baseline, and NOT a frontend problem:
 * packages/api hand-writes 979 type declarations against apps/web's 804. Three
 * derivation sources go unused at three layers, so each gets its own flag.
 */
function typeProvenanceFlags(s: Signals, path: string): string[] {
  const flags: string[] = [];
  const derives = s.zodInfer + s.drizzleInfer + s.infersContract;

  // Layer 1: the database. 61 drizzle tables, ~100 $inferSelect uses, against
  // 246 hand-written Row/Record/View/Info types in the API alone.
  if (s.usesDbSchema > 0 && s.rowTypes > 0 && s.drizzleInfer === 0) {
    flags.push("row-type-not-inferred: hand-written row shape beside a drizzle table");
  }
  // A restated pgEnum: DeploymentRow spells out `status` and `reason` members
  // that deploymentStatusEnum/deploymentReasonEnum already define.
  if (s.usesDbSchema > 0 && s.literalUnions > 0 && s.drizzleInfer === 0) {
    flags.push(`restated-enum?: ${s.literalUnions} literal union(s) beside a db import`);
  }
  // Layer 2: zod schemas.
  if (s.zodSchemas > 0 && s.handTypes > 0 && s.zodInfer === 0) {
    flags.push("schema-and-handwritten-types: zod schema present but no z.infer");
  }
  // Layer 3: the oRPC contract, consumed by the client.
  if (path.startsWith("apps/web/") && s.handTypes >= 3 && s.infersContract === 0) {
    flags.push("web-local-types: declares shapes without deriving from the contract");
  }
  // Catch-all for any layer: a type-heavy file deriving nothing from anywhere.
  if (s.handTypes >= 4 && derives === 0) {
    flags.push(`underived-types: ${s.handTypes} declarations, no inference from any source`);
  }
  return flags;
}

/** Axis 1, not "try/catch is bad". MIXING is bad: a caller cannot tell which
 *  half of the module it is talking to. */
function errorModelFlags(s: Signals): string[] {
  const flags: string[] = [];
  if (s.usesResult > 0 && (s.tryCatch > 0 || s.promiseCatch > 0)) {
    flags.push("mixed-error-model: imports better-result AND uses try/catch or .catch");
  }
  if (s.usesResult === 0 && s.tryCatch >= 2) {
    flags.push("throw-based: multiple try/catch, no Result");
  }
  if (s.promiseCatch > 0 && s.usesResult === 0) {
    flags.push("swallowed-rejection: .catch() with no Result to carry the failure");
  }
  return flags;
}

/** Axis 4: every assertion is an unchecked claim. */
function escapeHatchFlags(s: Signals): string[] {
  const flags: string[] = [];
  if (s.doubleCasts > 0) flags.push(`double-cast: ${s.doubleCasts} 'as unknown as'`);
  if (s.casts >= 5) flags.push(`cast-heavy: ${s.casts} assertions`);
  if (s.suppressions > 0) flags.push(`suppressions: ${s.suppressions}`);
  return flags;
}

/** Axis 6: cycles and compatibility facades. */
function graphFlags(s: Signals, inCycle: boolean): string[] {
  const flags: string[] = [];
  if (inCycle) flags.push("in-import-cycle");
  if (s.reExports > 0) flags.push(`re-exports: ${s.reExports} (facade?)`);
  return flags;
}

/**
 * Escalation is deliberately generous for high-stakes paths: over-reviewing a
 * crypto file costs minutes, under-reviewing one costs an incident.
 */
function tierFor(args: {
  flags: string[];
  inCycle: boolean;
  highStakes: boolean;
  cloneGroups: number;
  doubleCasts: number;
}): FileSheet["tier"] {
  const { flags, inCycle, highStakes, cloneGroups, doubleCasts } = args;
  if (inCycle || (highStakes && flags.length > 0) || flags.length >= 5) return 3;
  if (flags.length >= 3 || cloneGroups > 0 || doubleCasts > 0) return 2;
  if (flags.length > 0) return 1;
  return 0;
}

export function assessFile(path: string, source: string, cross: CrossFileEvidence): FileSheet {
  const signals = countSignals(source);
  const lines = source.split("\n").length;
  const highStakes = HIGH_STAKES.test(path);
  const inCycle = cross.cycles.has(path);
  const cloneGroups = cross.clones.get(path) ?? 0;
  const deadCode = cross.dead.get(path) ?? 0;

  const flags = [
    ...typeProvenanceFlags(signals, path),
    ...errorModelFlags(signals),
    ...escapeHatchFlags(signals),
    ...graphFlags(signals, inCycle),
  ];
  if (cloneGroups > 0) flags.push(`clone-groups: ${cloneGroups}`);
  if (deadCode > 0) flags.push(`dead-code-findings: ${deadCode}`);
  if (lines > 400) flags.push(`long-file: ${lines} lines`);

  const tier = tierFor({
    flags,
    inCycle,
    highStakes,
    cloneGroups,
    doubleCasts: signals.doubleCasts,
  });

  return { path, lines, tier, highStakes, signals, flags, inCycle, cloneGroups, deadCode };
}
