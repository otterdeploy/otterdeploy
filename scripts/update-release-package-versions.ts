#!/usr/bin/env bun
/**
 * Stamp one release version into every package.json that ships.
 *
 * otterdeploy releases on a single `v*.*.*` tag. That tag builds the pinned
 * ghcr images the in-app updater consumes AND publishes `@otterdeploy/cli` to
 * npm, so both artifacts carry the same number and `otd -v` can be compared to
 * `otd platform version` by eye. Before this, the CLI had its own `cli-v*` train
 * and the two drifted to 0.1.3 vs v0.7.0 — a gap that told a bug reporter (and
 * us) nothing about which pair of halves was actually running.
 *
 * The list below is deliberately short. A package belongs here only if its
 * version has to travel INSIDE the artifact:
 *
 *   apps/cli   — npm reads package.json at publish time, and src/version.ts
 *                imports it so `otd -v` and the compat handshake agree.
 *
 * apps/server, apps/web and apps/builder are NOT here on purpose: they ship as
 * container images and learn their version from the booted image tag via
 * `OTTERDEPLOY_VERSION` (packages/api/src/routers/system/check.ts). Stamping a
 * second, silently-diverging copy into their package.json would create exactly
 * the ambiguity this script exists to remove.
 *
 * Usage:
 *   bun run scripts/update-release-package-versions.ts 0.8.0
 *   bun run scripts/update-release-package-versions.ts v0.8.0 --github-output
 *
 * Run it locally to cut a release (bump, commit, tag); CI runs it again from
 * the tag so a hand-edited version can never contradict the tag that published.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";

/** Every package.json whose version must match the release tag. */
export const RELEASE_PACKAGE_FILES = ["apps/cli/package.json"] as const;

/** `[v]MAJOR.MINOR.PATCH[-prerelease]` — the shape our release tags take. */
const VERSION_RE = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

/** Strip a leading `v` and reject anything that isn't a release version. */
export function normalizeVersion(input: string): string {
  const match = VERSION_RE.exec(input.trim());
  if (!match) {
    throw new Error(
      `Invalid release version ${JSON.stringify(input)} — expected [v]MAJOR.MINOR.PATCH[-prerelease].`,
    );
  }
  return match[1] as string;
}

interface StampResult {
  /** Files whose version actually moved. */
  updated: string[];
}

export function updateReleasePackageVersions(version: string, rootDir: string): StampResult {
  const updated: string[] = [];

  for (const relativePath of RELEASE_PACKAGE_FILES) {
    const filePath = resolve(rootDir, relativePath);
    const source = readFileSync(filePath, "utf8");
    const manifest = JSON.parse(source) as Record<string, unknown>;
    if (manifest.version === version) continue;

    // Spreading re-assigns `version` in place rather than appending it, so the
    // key order (and therefore the diff) stays minimal.
    writeFileSync(filePath, `${JSON.stringify({ ...manifest, version }, null, 2)}\n`);
    updated.push(relativePath);
  }

  return { updated };
}

function main(argv: string[]): void {
  let version: string | undefined;
  let root = process.cwd();
  let githubOutput = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--github-output") {
      githubOutput = true;
    } else if (arg === "--root") {
      i += 1;
      root = argv[i] ?? root;
    } else if (!arg.startsWith("-") && version === undefined) {
      version = arg;
    } else {
      throw new Error(`Unexpected argument ${JSON.stringify(arg)}.`);
    }
  }

  if (version === undefined) {
    throw new Error("Missing required <version> argument.");
  }

  const normalized = normalizeVersion(version);
  const { updated } = updateReleasePackageVersions(normalized, root);

  if (updated.length === 0) {
    console.log(`All release package versions already at ${normalized}.`);
  } else {
    for (const file of updated) console.log(`${file} → ${normalized}`);
  }

  if (githubOutput) {
    // oxlint-disable-next-line node/no-process-env -- CI boundary
    const outputPath = process.env.GITHUB_OUTPUT;
    if (!outputPath) throw new Error("--github-output was passed but GITHUB_OUTPUT is unset.");
    appendFileSync(outputPath, `version=${normalized}\nchanged=${updated.length > 0}\n`);
  }
}

if (import.meta.main) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
