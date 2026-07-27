#!/usr/bin/env bun
/**
 * Production certification harness for od-5j8.31.
 *
 * Runs the hostile-path security suite under
 * `packages/api/src/__tests__/security/**` and emits a machine-readable
 * pass/fail report, one entry per encoded issue-id invariant, so od-5j8.33's
 * certification gate (and CI) has something objective to consult instead of
 * a human reading test output.
 *
 * Each test file in that directory is named `<issue-id>-<slug>.test.ts`
 * (e.g. `od-5j8.2-capability-authz-matrix.test.ts`) — the issue id prefix is
 * the source of truth this script uses to attribute pass/fail to an
 * invariant. Adding a new hostile-path file for another sibling issue is
 * enough to extend certification; no registry to keep in sync by hand.
 *
 * Usage:
 *   bun test-infra/scripts/security-certify.mjs [--out <path>] [--json]
 *
 * Exit code: 0 when every invariant passes, 1 otherwise (or on a harness
 * error) — CI can gate on this directly.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const apiDir = resolve(repositoryRoot, "packages/api");
const securitySuiteDir = "src/__tests__/security";

const ISSUE_FILE_PATTERN = /^(od-[\w]+(?:\.\d+)*)-(.+)\.test\.ts$/;

function parseArgs(argv) {
  const args = { out: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i] === "--json") args.json = true;
  }
  return args;
}

/** Run vitest's JSON reporter over the security suite and return the parsed report. */
/**
 * The slice of vitest's `--reporter=json` output this script actually consumes.
 * @typedef {{ status: string, fullName: string, failureMessages: string[] }} VitestAssertion
 * @typedef {{ name: string, assertionResults: VitestAssertion[] }} VitestFileResult
 * @typedef {{ testResults: VitestFileResult[] }} VitestReport
 */

/** @returns {Promise<VitestReport>} */
async function runSuite() {
  const proc = Bun.spawn(["bun", "--bun", "vitest", "run", securitySuiteDir, "--reporter=json"], {
    cwd: apiDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  /** @type {VitestReport} */
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (cause) {
    throw new Error(
      `security-certify: could not parse vitest JSON output (exit ${exitCode}).\n` +
        `--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}\n--- parse error ---\n${cause}`,
    );
  }
  return parsed;
}

/**
 * Group vitest's per-file test results into one entry per issue-id invariant.
 * @param {VitestReport} vitestReport
 */
function buildInvariantReport(vitestReport) {
  const invariants = [];
  const unattributed = [];

  for (const fileResult of vitestReport.testResults) {
    const fileName = fileResult.name.split("/").pop() ?? fileResult.name;
    const match = ISSUE_FILE_PATTERN.exec(fileName);
    const relativePath = fileResult.name.includes(apiDir)
      ? `packages/api/${fileResult.name.slice(apiDir.length + 1)}`
      : fileResult.name;

    const passed = fileResult.assertionResults.filter((a) => a.status === "passed").length;
    const failed = fileResult.assertionResults.filter((a) => a.status === "failed").length;
    const total = fileResult.assertionResults.length;
    const failingTests = fileResult.assertionResults
      .filter((a) => a.status === "failed")
      .map((a) => ({ name: a.fullName, failureMessages: a.failureMessages }));

    const entry = {
      issueId: match ? match[1] : null,
      slug: match ? match[2] : fileName,
      file: relativePath,
      status: fileResult.status === "passed" && failed === 0 ? "pass" : "fail",
      tests: { total, passed, failed },
      ...(failingTests.length > 0 ? { failingTests } : {}),
    };

    if (match) invariants.push(entry);
    else unattributed.push(entry);
  }

  invariants.sort((a, b) => a.issueId.localeCompare(b.issueId, undefined, { numeric: true }));

  return { invariants, unattributed };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();

  let vitestReport;
  try {
    vitestReport = await runSuite();
  } catch (cause) {
    const failureReport = {
      generatedAt: startedAt,
      suite: `packages/api/${securitySuiteDir}`,
      harnessError: cause instanceof Error ? cause.message : String(cause),
      overall: { status: "fail" },
    };
    process.stderr.write(`${JSON.stringify(failureReport, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  const { invariants, unattributed } = buildInvariantReport(vitestReport);
  const overallStatus =
    vitestReport.success &&
    invariants.every((i) => i.status === "pass") &&
    unattributed.length === 0
      ? "pass"
      : "fail";

  const report = {
    generatedAt: startedAt,
    suite: `packages/api/${securitySuiteDir}`,
    overall: {
      status: overallStatus,
      totalTests: vitestReport.numTotalTests,
      passed: vitestReport.numPassedTests,
      failed: vitestReport.numFailedTests,
      invariantCount: invariants.length,
    },
    invariants,
    ...(unattributed.length > 0 ? { unattributed } : {}),
  };

  const rendered = JSON.stringify(report, null, 2);
  if (args.out) {
    mkdirSync(dirname(resolve(repositoryRoot, args.out)), { recursive: true });
    writeFileSync(resolve(repositoryRoot, args.out), `${rendered}\n`);
  }
  if (args.json || !args.out) {
    process.stdout.write(`${rendered}\n`);
  }

  if (!args.json) {
    const icon = (status) => (status === "pass" ? "PASS" : "FAIL");
    process.stderr.write(`\nsecurity certification: ${icon(overallStatus)}\n`);
    for (const invariant of invariants) {
      process.stderr.write(
        `  [${icon(invariant.status)}] ${invariant.issueId} — ${invariant.slug} ` +
          `(${invariant.tests.passed}/${invariant.tests.total})\n`,
      );
    }
    if (unattributed.length > 0) {
      process.stderr.write(
        `  WARNING: ${unattributed.length} test file(s) under the security suite have no ` +
          `parseable issue-id prefix and were not attributed to an invariant.\n`,
      );
    }
  }

  process.exitCode = overallStatus === "pass" ? 0 : 1;
}

await main();
