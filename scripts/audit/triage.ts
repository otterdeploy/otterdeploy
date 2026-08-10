#!/usr/bin/env bun
/**
 * Per-file audit triage: computes the evidence sheet for every tracked source
 * file and assigns a review tier.
 *
 * The codebase is ~1600 reviewable source files. Reviewing them in file order
 * is how an audit dies: the reviewer burns attention on files with nothing
 * wrong and runs out of patience before reaching the ones that matter. This
 * front-loads every mechanically-detectable signal so a human only opens a file
 * when something already points at it, and opens it knowing what to look for.
 *
 * It NEVER decides a file is fine. A clean sheet means "no detector fired",
 * which is the start of a review, not the end of one. Axis 3 (boundary
 * honesty) and axis 8 (comment integrity) are invisible to grep.
 *
 *   bun scripts/audit/triage.ts              # full run, writes .audit/
 *   bun scripts/audit/triage.ts --tier 3     # print one tier's worklist
 *   bun scripts/audit/triage.ts --file <p>   # dossier for a single file
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { FileSheet } from "./assess";

import { assessFile } from "./assess";
import { EXCLUDED } from "./detectors";
import { collectEvidence } from "./evidence";

const ROOT = join(import.meta.dir, "..", "..");
const OUT_DIR = join(ROOT, ".audit");

function trackedSourceFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "packages", "apps", "scripts"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .split("\n")
    .filter((p) => /\.(ts|tsx)$/.test(p))
    .filter((p) => !/\.test\.tsx?$|__tests__|\.bench\.ts$/.test(p))
    .filter((p) => !EXCLUDED.test(p));
}

function renderDossier(sheet: FileSheet): string {
  const sig = Object.entries(sheet.signals)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k}=${n}`)
    .join("  ");
  return [
    `${sheet.path}`,
    `  tier ${sheet.tier}${sheet.highStakes ? " (HIGH-STAKES PATH)" : ""} · ${sheet.lines} lines`,
    sig ? `  signals: ${sig}` : "  signals: none",
    ...sheet.flags.map((f) => `  - ${f}`),
  ].join("\n");
}

function renderWorklist(sheets: FileSheet[], tiers: FileSheet[][]): string {
  const [t0, t1, t2, t3] = tiers;
  const bullets = (rows: FileSheet[] = []): string[] =>
    rows.map((s) => `- \`${s.path}\`, ${s.flags.join("; ")}`);
  return [
    "# Audit worklist (generated)",
    "",
    "Regenerate: `bun scripts/audit/triage.ts`. Judge each file against",
    "`docs/audit/RUBRIC.md`. **A tier-0 file is UNREVIEWED, not approved.**",
    "",
    `In scope: **${sheets.length}** files (tests, generated and vendored excluded).`,
    "",
    "| Tier | Meaning | Files |",
    "| --- | --- | --- |",
    `| 3 | Cycle member, or high-stakes path with any signal | ${t3?.length ?? 0} |`,
    `| 2 | Clone group, double cast, or 3+ signals | ${t2?.length ?? 0} |`,
    `| 1 | One or two signals | ${t1?.length ?? 0} |`,
    `| 0 | No detector fired. Read, but expect it to be quick | ${t0?.length ?? 0} |`,
    "",
    "## Tier 3: review first",
    "",
    ...bullets(t3),
    "",
    "## Tier 2",
    "",
    ...bullets(t2),
    "",
  ].join("\n");
}

function main(): void {
  const args = process.argv.slice(2);
  const argAfter = (flag: string): string | null => {
    const i = args.indexOf(flag);
    return i >= 0 ? (args[i + 1] ?? null) : null;
  };
  const fileArg = argAfter("--file");
  const tierRaw = argAfter("--tier");

  console.log("Collecting cross-file evidence from fallow…");
  const cross = collectEvidence(ROOT);
  console.log(
    `  cycles: ${cross.cycles.size} files · clones touching ${cross.clones.size} · dead-code in ${cross.dead.size}`,
  );

  const paths = trackedSourceFiles();
  console.log(`Assessing ${paths.length} source files…`);

  const sheets: FileSheet[] = [];
  for (const path of paths) {
    try {
      sheets.push(assessFile(path, readFileSync(join(ROOT, path), "utf8"), cross));
    } catch {
      // Unreadable (symlink, race with a checkout): skip rather than abort a
      // 1600-file run for one file.
    }
  }

  if (fileArg) {
    const hit = sheets.find((s) => s.path === fileArg || s.path.endsWith(fileArg));
    console.log(hit ? renderDossier(hit) : `no sheet for ${fileArg}`);
    return;
  }

  sheets.sort(
    (a, b) => b.tier - a.tier || b.flags.length - a.flags.length || a.path.localeCompare(b.path),
  );

  if (tierRaw !== null) {
    for (const s of sheets.filter((x) => x.tier === Number(tierRaw))) {
      console.log(renderDossier(s), "\n");
    }
    return;
  }

  const tiers = [0, 1, 2, 3].map((t) => sheets.filter((s) => s.tier === t));

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "worklist.json"), `${JSON.stringify(sheets, null, 2)}\n`);
  writeFileSync(join(OUT_DIR, "WORKLIST.md"), `${renderWorklist(sheets, tiers)}\n`);

  console.log("");
  for (const t of [3, 2, 1, 0]) console.log(`  tier ${t}: ${tiers[t]?.length ?? 0}`);
  console.log(`\nWrote ${join(OUT_DIR, "WORKLIST.md")}`);
}

main();
