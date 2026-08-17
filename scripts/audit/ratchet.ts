#!/usr/bin/env bun
/**
 * Phase 0 of the vetting sweep: the ratchet that stops the bleeding.
 *
 * The sweep takes weeks. Without a gate, the numbers it is driving down get
 * pushed back up by ordinary feature work in the meantime, and the effort nets
 * out to zero. This is that gate.
 *
 * It is a **ratchet, not a wall**: the 177 dead-code findings, 18 cycles and 356
 * clone groups that exist today block nobody. What fails CI is a number going
 * *up*. When a number goes down, the script says so and prints the command that
 * pins the new floor: that is how a phase's gain gets locked in
 * (`docs/audit/PLAN.md`, "Definition of done, per phase").
 *
 *   bun scripts/audit/ratchet.ts                  # totals vs the committed baseline
 *   bun scripts/audit/ratchet.ts --base <ref>     # + which findings this branch introduced
 *   bun scripts/audit/ratchet.ts --update         # re-pin the baseline to today's numbers
 *
 * Two things it deliberately does NOT gate on:
 *
 *   complexity: oxlint already errors at cyclomatic 15 (`.oxlintrc.json`).
 *     fallow's CRAP score assumes 0% coverage when no coverage file is passed,
 *     which makes every new function above cyclomatic 6 "critical". That is
 *     noise, not signal, so complexity is reported and left to lint.
 *   unlisted-dependencies: `vite-plus` is imported by ~40 test files while
 *     declared only at the root (od-hml). fallow attributes a project-wide
 *     finding to whichever file the changeset touched, so gating on it would
 *     fail every PR that edits a test until od-hml lands.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as z from "zod";

import { FALLOW_VERSION, fallowJson } from "./fallow";

const ROOT = join(import.meta.dir, "..", "..");
const BASELINE_PATH = join(ROOT, "docs", "audit", "baseline.json");

const totalsSchema = z.object({
  deadCodeIssues: z.number(),
  circularDependencies: z.number(),
  cloneGroups: z.number(),
  duplicationPercentage: z.number(),
});

const baselineSchema = z.object({
  fallowVersion: z.string(),
  measured: z.string(),
  totals: totalsSchema,
});

type Totals = z.infer<typeof totalsSchema>;
type Baseline = z.infer<typeof baselineSchema>;

type Finding = Record<string, unknown>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

const MEASURES: { key: keyof Totals; label: string }[] = [
  { key: "deadCodeIssues", label: "dead-code findings" },
  { key: "circularDependencies", label: "import cycles" },
  { key: "cloneGroups", label: "clone groups" },
  { key: "duplicationPercentage", label: "duplicated lines %" },
];

/**
 * Graph-shape findings that are never a legitimate work-in-progress state, so a
 * newly introduced one fails on its own rather than waiting for a total to move.
 * The totals ratchet nets out, deleting an unused type elsewhere in the same PR
 * would hide a new cycle, and these are the findings that must not be hidden.
 */
const GATED_FINDINGS = new Set([
  "circular_dependencies",
  "re_export_cycles",
  "unresolved_imports",
  "duplicate_exports",
  "boundary_violations",
]);

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Read one number out of a fallow report, refusing to guess if it is absent. */
function num(report: Record<string, unknown>, section: string, key: string): number {
  const holder = report[section];
  const value = isRecord(holder) ? holder[key] : undefined;
  if (typeof value !== "number") {
    throw new Error(
      `fallow report has no numeric ${section}.${key}. The schema moved under the ` +
        `version pin in scripts/audit/fallow.ts, so this gate is measuring nothing`,
    );
  }
  return value;
}

function measure(): Totals {
  const dead = fallowJson(["dead-code"], ROOT);
  const dupes = fallowJson(["dupes"], ROOT);
  if (!dead || !dupes) {
    throw new Error(`fallow@${FALLOW_VERSION} produced no report. The ratchet cannot run`);
  }
  return {
    deadCodeIssues: num(dead, "summary", "total_issues"),
    circularDependencies: num(dead, "summary", "circular_dependencies"),
    cloneGroups: num(dupes, "stats", "clone_groups"),
    duplicationPercentage: round2(num(dupes, "stats", "duplication_percentage")),
  };
}

function readBaseline(): Baseline {
  const parsed = baselineSchema.parse(JSON.parse(readFileSync(BASELINE_PATH, "utf8")));
  if (parsed.fallowVersion !== FALLOW_VERSION) {
    throw new Error(
      `baseline was measured with fallow ${parsed.fallowVersion} but the pin is ` +
        `${FALLOW_VERSION}. Counts are not comparable across versions. Re-run ` +
        "`bun scripts/audit/ratchet.ts --update` in the commit that bumps the pin",
    );
  }
  return parsed;
}

function writeBaseline(totals: Totals): void {
  const next: Baseline = {
    fallowVersion: FALLOW_VERSION,
    measured: new Date().toISOString().slice(0, 10),
    totals,
  };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`);
}

/** Print the totals table; return the measures that got worse. */
function compareTotals(now: Totals, base: Totals): (keyof Totals)[] {
  const worse: (keyof Totals)[] = [];
  for (const { key, label } of MEASURES) {
    const delta = now[key] - base[key];
    const mark = delta > 0 ? "  WORSE" : delta < 0 ? "  better" : "";
    const cells = `${String(now[key]).padStart(7)}  ${String(base[key]).padStart(8)}`;
    console.log(`  ${label.padEnd(20)}${cells}${mark}`);
    if (delta > 0) worse.push(key);
  }
  return worse;
}

/** The one file a finding points at, for the findings that point at one. */
function findingPath(item: Finding): string | undefined {
  return asString(item.path) ?? asString(item.file);
}

/** The symbol or package a finding names, for the findings that name one. */
function findingName(item: Finding): string | undefined {
  return (
    asString(item.export_name) ??
    asString(item.type_name) ??
    asString(item.package_name) ??
    asString(item.name)
  );
}

/** The files a finding spans: cycles list them, clone groups nest them. */
function findingFiles(item: Finding): string[] | undefined {
  if (Array.isArray(item.files)) return item.files.map((f) => asString(f) ?? "?");
  if (Array.isArray(item.instances)) {
    return item.instances.map((i) => (isRecord(i) ? asString(i.file) : undefined) ?? "?");
  }
  return undefined;
}

/**
 * Project-wide findings (dependencies) name a package rather than a path, so
 * the first importer is what tells the reader where to start looking.
 */
function withFirstImporter(name: string, item: Finding): string {
  const importers = Array.isArray(item.imported_from) ? item.imported_from : undefined;
  const head = importers?.[0];
  const first = isRecord(head) ? asString(head.path) : undefined;
  if (!first) return name;
  const rest = (importers?.length ?? 1) - 1;
  return rest > 0 ? `${name} (${first}, +${rest} more)` : `${name} (${first})`;
}

/** One line naming whatever a finding is about, whichever shape it has. */
function describe(item: Finding): string {
  const at = findingPath(item);
  const name = findingName(item);
  if (at) return name ? `${at}, ${name}` : at;
  const files = findingFiles(item);
  if (files) return files.join(" <-> ");
  if (name) return withFirstImporter(name, item);
  return JSON.stringify(item).slice(0, 120);
}

/** Every finding the changeset introduced, category → findings. */
function introducedByCategory(audit: Record<string, unknown>): Map<string, Finding[]> {
  const out = new Map<string, Finding[]>();
  const dead = isRecord(audit.dead_code) ? audit.dead_code : {};
  for (const [category, items] of Object.entries(dead)) {
    if (!Array.isArray(items)) continue;
    const introduced = items.filter(isRecord).filter((i) => Boolean(i.introduced));
    if (introduced.length > 0) out.set(category, introduced);
  }
  const duplication = isRecord(audit.duplication) ? audit.duplication : undefined;
  const groupsRaw = duplication ? duplication.clone_groups : undefined;
  const groups = Array.isArray(groupsRaw) ? groupsRaw : [];
  const clones = groups.filter(isRecord).filter((g) => Boolean(g.introduced));
  if (clones.length > 0) out.set("clone_groups", clones);
  return out;
}

/** Print what this changeset added, marking the ones that fail. */
function report(audit: Record<string, unknown>, baseRef: string): void {
  const count = audit.changed_files_count;
  const changed = typeof count === "number" ? count : "?";
  console.log(`\nIntroduced since ${baseRef} (${changed} changed files):`);
  const byCategory = introducedByCategory(audit);
  if (byCategory.size === 0) console.log("  (none)");
  for (const [category, items] of byCategory) {
    const mark = GATED_FINDINGS.has(category) ? "FAIL" : "note";
    for (const item of items) console.log(`  ${mark}  ${category}  ${describe(item)}`);
  }
  const complexityHolder = isRecord(audit.complexity) ? audit.complexity : undefined;
  const complexityRaw = complexityHolder ? complexityHolder.findings : undefined;
  const complexity = Array.isArray(complexityRaw) ? complexityRaw : [];
  if (complexity.length > 0) {
    const n = complexity.length;
    console.log(`\n  ${n} complexity findings in changed files. Reported only;`);
    console.log("  oxlint gates complexity (see the header of this file).");
  }
}

/** The introduced findings that fail on their own, as printable lines. */
function gatedRegressions(audit: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [category, items] of introducedByCategory(audit)) {
    if (!GATED_FINDINGS.has(category)) continue;
    for (const item of items) out.push(`${category} introduced: ${describe(item)}`);
  }
  return out;
}

function runUpdate(now: Totals): void {
  writeBaseline(now);
  console.log(`Pinned ${BASELINE_PATH.replace(`${ROOT}/`, "")} to:`);
  for (const { key, label } of MEASURES) {
    console.log(`  ${label.padEnd(20)}${String(now[key]).padStart(7)}`);
  }
  console.log("\nUpdate the baseline table in docs/audit/PLAN.md to match.");
}

function pass(now: Totals, base: Totals): void {
  const better = MEASURES.filter(({ key }) => now[key] < base[key]);
  if (better.length === 0) {
    console.log("\nPASS, nothing regressed.");
    return;
  }
  console.log(
    `\nPASS: ${better.map((m) => m.label).join(", ")} improved. Lock it in:\n` +
      "  bun scripts/audit/ratchet.ts --update",
  );
}

function fail(worse: (keyof Totals)[], now: Totals, base: Totals, introduced: string[]): void {
  console.log("\nFAIL");
  for (const key of worse) console.log(`  ${key} rose from ${base[key]} to ${now[key]}`);
  for (const line of introduced) console.log(`  ${line}`);
  console.log(
    "\nFix the finding, or (if the rise is deliberate and justified) say why in the\n" +
      "commit message and re-pin with `bun scripts/audit/ratchet.ts --update`.",
  );
  process.exitCode = 1;
}

function main(): void {
  const args = process.argv.slice(2);
  const baseIndex = args.indexOf("--base");
  const baseRef = baseIndex >= 0 ? args[baseIndex + 1] : null;

  console.log(`Measuring with fallow@${FALLOW_VERSION}…\n`);
  const now = measure();

  if (args.includes("--update")) {
    runUpdate(now);
    return;
  }

  const base = readBaseline();
  console.log(`  measure              current  baseline (${base.measured})`);
  const worse = compareTotals(now, base.totals);

  let introduced: string[] = [];
  if (baseRef) {
    const audit = fallowJson(["audit", "--base", baseRef], ROOT);
    if (!audit) {
      // Not recoverable: the changed-file half of the gate would silently pass.
      throw new Error(`fallow audit --base ${baseRef} produced no report`);
    }
    report(audit, baseRef);
    introduced = gatedRegressions(audit);
  }

  if (worse.length === 0 && introduced.length === 0) pass(now, base.totals);
  else fail(worse, now, base.totals, introduced);
}

main();
