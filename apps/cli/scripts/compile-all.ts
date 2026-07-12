#!/usr/bin/env bun
/**
 * Cross-compile the CLI into standalone, runtime-free binaries — one per
 * platform Bun targets. Output lands in `dist/`, named
 * `otterdeploy-<os>-<arch>[.exe]`, which the release workflow uploads as
 * GitHub release assets. Run locally with `bun run compile:all`.
 */

import { $ } from "bun";
import { mkdir } from "node:fs/promises";

const TARGETS = [
  { bun: "bun-linux-x64", out: "otterdeploy-linux-x64" },
  { bun: "bun-linux-arm64", out: "otterdeploy-linux-arm64" },
  { bun: "bun-darwin-x64", out: "otterdeploy-darwin-x64" },
  { bun: "bun-darwin-arm64", out: "otterdeploy-darwin-arm64" },
  { bun: "bun-windows-x64", out: "otterdeploy-windows-x64.exe" },
] as const;

await mkdir("dist", { recursive: true });

for (const target of TARGETS) {
  console.log(`Compiling ${target.bun} → dist/${target.out}`);
  await $`bun build --compile --minify --sourcemap --target=${target.bun} ./src/index.ts --outfile dist/${target.out}`;
}

console.log(`\nBuilt ${TARGETS.length} binaries in dist/.`);
