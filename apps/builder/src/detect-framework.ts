/**
 * Detect a built service's framework from the work tree we already have.
 *
 * The graph renders a brand logo per service. The framework is a static
 * property of the repo, and the builder already clones + analyses that repo
 * on every build — so we capture the framework HERE, from local files, and
 * persist it on the service row. The graph then reads the stored value. We
 * never call the git provider's API for it (that path was anonymous-rate-
 * limited at 60/hr and hammered on the graph's 5s poll).
 *
 * Two local sources, in priority order:
 *
 *   1. The cloned `package.json` (at the service's sourceSubdir). Run the same
 *      dependency heuristic the wizard preview uses
 *      (`detectFrameworkFromPkg`) — it's finer-grained than railpack's own
 *      detection (distinguishes astro/sveltekit/hono/nest/express/…, which
 *      railpack collapses to "node"/"vite"). A *specific* hit wins.
 *
 *   2. railpack's `--info-out` analysis (`railpack-info.json`). Covers the
 *      non-Node languages package.json can't (go/python/rust/ruby) plus the
 *      bun runtime, and confirms plain "node".
 *
 * Never throws: any missing/garbage file collapses to `null`. Logo metadata
 * must never fail a build.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  detectFrameworkFromPkg,
  type FrameworkKind,
  type PackageJsonLike,
} from "@otterdeploy/shared/framework";

import type { LogSink } from "./log-stream";
import { RAILPACK_INFO_FILE } from "./railpack";

/** Shape of the bits of `railpack-info.json` we read. railpack emits more
 *  (plan, resolvedPackages, logs); we only need the detected providers and
 *  the node runtime/framework. */
interface RailpackInfo {
  detectedProviders?: string[];
  metadata?: Record<string, string>;
  success?: boolean;
}

/** Read + JSON.parse a file, returning null on any error (missing, unreadable,
 *  malformed). The caller treats null as "nothing detected". */
async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

/**
 * Map railpack's analysis to a `FrameworkKind`. `metadata.nodeRuntime` carries
 * the node-level framework (next/nuxt/vite/remix/bun/node); `detectedProviders`
 * (or `metadata.providers`) carries the language (railpack spells Go "golang").
 * Unknown providers (e.g. php — no logo today) → null.
 */
function frameworkFromRailpackInfo(info: RailpackInfo | null): FrameworkKind {
  if (!info || info.success === false) return null;
  const meta = info.metadata ?? {};

  switch (meta["nodeRuntime"]) {
    case "next":
      return "next";
    case "nuxt":
      return "nuxt";
    case "vite":
      return "vite";
    case "remix":
      return "remix";
    case "bun":
      return "bun";
    case "node":
      return "node";
  }

  const provider = info.detectedProviders?.[0] ?? meta["providers"];
  switch (provider) {
    case "node":
      return "node";
    case "golang":
      return "go";
    case "python":
      return "python";
    case "rust":
      return "rust";
    case "ruby":
      return "ruby";
    default:
      return null;
  }
}

/**
 * Resolve the framework for a freshly-built service from its work tree. Call
 * after `railpack prepare` has written `railpack-info.json` and before the
 * pipeline removes the clone dir.
 */
export async function detectServiceFramework(opts: {
  workDir: string;
  /** Service's repo subdirectory (monorepo); null = repo root. The app's own
   *  package.json always lives here, even for a workspace built from the root. */
  sourceSubdir: string | null;
  /** Directory railpack actually wrote `railpack-info.json` to. For a workspace
   *  service this is the repo root (not the subdir); defaults to the subdir. */
  buildDir?: string;
  sink: LogSink;
}): Promise<FrameworkKind> {
  // 1. Local package.json heuristic — finest granularity for Node services.
  //    Always the app's own package.json (its subdir), even when the build ran
  //    from the workspace root.
  const pkg = await readJsonFile<PackageJsonLike>(
    join(opts.workDir, opts.sourceSubdir ?? "", "package.json"),
  );
  const fromPkg = detectFrameworkFromPkg(pkg);
  if (fromPkg && fromPkg !== "node") {
    opts.sink.system(`detected framework: ${fromPkg} (package.json)`);
    return fromPkg;
  }

  // 2. railpack's analysis — non-Node languages + bun + plain node. Written by
  //    `railpack prepare` into the build dir (the repo root for a workspace
  //    service, else the service's subdir), so read it from there.
  const info = await readJsonFile<RailpackInfo>(
    join(opts.buildDir ?? join(opts.workDir, opts.sourceSubdir ?? ""), RAILPACK_INFO_FILE),
  );
  const fromRailpack = frameworkFromRailpackInfo(info);
  const framework = fromRailpack ?? fromPkg ?? null;
  opts.sink.system(`detected framework: ${framework ?? "none"} (railpack)`);
  return framework;
}
