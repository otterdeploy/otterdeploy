/**
 * Build-context resolution for a Dockerfile that lives in a monorepo subdir.
 *
 * The incident this exists for: a turborepo service with root directory
 * `apps/web` and a Dockerfile at `apps/web/Dockerfile`. That Dockerfile is the
 * shape `turbo prune --docker` emits and every monorepo guide teaches: it
 * COPYs the ROOT lockfile and the sibling `packages/*` it depends on. We built
 * it with the context anchored at `apps/web`, so the very first
 * `COPY package.json bun.lock ./` resolved against `apps/web` and buildx died
 * with `failed to compute cache key: "/bun.lock": not found`. Nothing in the
 * message named the root directory, and no setting existed to fix it.
 *
 * Railpack got a workspace-root escalation (see `resolveBuildLayout`); the
 * Dockerfile path never did. This closes that gap WITHOUT silently changing
 * the context for services that build fine today: a Dockerfile doing
 * `COPY package.json .` inside its own subdir means a different file at the
 * root, so a blanket escalation would swap one working build for a broken one.
 *
 * Instead the answer is knowable from the Dockerfile text before a single
 * layer is pulled, the same way `diagnoseSubdir` reads the tree and
 * `assertProviderCanServeSpa` reads railpack's analysis: parse the COPY/ADD
 * sources, and escalate only when a source cannot resolve under the subdir but
 * DOES resolve from the repo root.
 */

import type { DockerfileContextMode } from "@otterdeploy/shared/build-config";

import { Result } from "better-result";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, normalize, resolve, sep } from "node:path";
import * as z from "zod";

/** Only the field `rootIsWorkspaceSync` reads; every other key is ignored. */
const workspacePkgSchema = z.object({
  workspaces: z
    .union([z.array(z.string()), z.object({ packages: z.array(z.string()).optional() })])
    .optional(),
});

/** How the build context for a subdir Dockerfile is chosen. Re-exported from
 *  the shared build-config rather than restated here: the manifest schema and
 *  the DB column already key off that union, and a second copy would be a
 *  second thing to keep in step.
 *
 *  - `auto`   inspect the Dockerfile's COPY sources and escalate to the repo
 *             root only when they demand it (default; see `analyzeCopySources`)
 *  - `subdir` always anchor at the service's root directory (pre-existing
 *             behavior; the escape hatch when `auto` guesses wrong)
 *  - `root`   always anchor at the repo root (for a Dockerfile whose root-
 *             relative COPYs are all globs/optional and so can't be detected) */
export type DockerfileContext = DockerfileContextMode;

/**
 * Strip a Dockerfile down to logical instructions: comments removed, line
 * continuations joined. Parser directives (`# syntax=`) are comments too, and
 * carry no COPY sources, so dropping them is safe.
 */
export function joinInstructions(text: string): string[] {
  const out: string[] = [];
  let pending = "";
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    // A comment inside a continuation is skipped by the Docker parser too,
    // without terminating the continuation.
    if (line.startsWith("#")) continue;
    if (line.endsWith("\\")) {
      pending += `${line.slice(0, -1).trim()} `;
      continue;
    }
    const full = `${pending}${line}`.trim();
    pending = "";
    if (full) out.push(full);
  }
  if (pending.trim()) out.push(pending.trim());
  return out;
}

/**
 * The context-relative source paths of every COPY/ADD that actually reads from
 * the build context.
 *
 * Skipped deliberately:
 *   - `--from=<stage|image>`: reads from another stage or image, never the
 *     context, so it says nothing about where the context should be anchored.
 *   - remote ADD sources (`http://`, `https://`, `git@`): fetched, not copied.
 *   - heredoc bodies (`COPY <<EOF`): inline content, no context read.
 *
 * The final argument is the destination and is always dropped. JSON-array form
 * (`COPY ["a", "b"]`) is handled; so are the `--chown` / `--chmod` /
 * `--link` / `--parents` / `--exclude` flags.
 */
export function parseCopySources(text: string): string[] {
  const sources: string[] = [];
  for (const instruction of joinInstructions(text)) {
    const match = /^(COPY|ADD)\s+(.*)$/i.exec(instruction);
    if (!match?.[2]) continue;
    let rest = match[2].trim();

    // Heredoc form: the body is inline content, nothing is read from context.
    if (/<<-?['"]?[A-Za-z_]/.test(rest)) continue;

    let fromAnotherStage = false;
    // Consume leading `--flag` / `--flag=value` tokens.
    while (rest.startsWith("--")) {
      const flagMatch = /^--\S+\s*/.exec(rest);
      if (!flagMatch) break;
      const flag = flagMatch[0].trim();
      if (/^--from=/i.test(flag)) fromAnotherStage = true;
      rest = rest.slice(flagMatch[0].length);
    }
    if (fromAnotherStage || !rest) continue;

    const args = rest.startsWith("[") ? parseJsonForm(rest) : rest.split(/\s+/).filter(Boolean);
    // Last arg is the destination; everything before it is a source.
    if (args.length < 2) continue;
    for (const src of args.slice(0, -1)) {
      if (/^(https?:\/\/|git@|github\.com\/)/i.test(src)) continue;
      sources.push(src);
    }
  }
  return sources;
}

/** `COPY ["src", "dest"]` — quoted, comma-separated. Falls back to whitespace
 *  splitting if the array is malformed (buildx would reject it anyway). */
function parseJsonForm(rest: string): string[] {
  const inner = /^\[(.*)\]/s.exec(rest)?.[1];
  if (inner === undefined) return [];
  const out: string[] = [];
  for (const raw of inner.split(",")) {
    const trimmed = raw.trim().replace(/^["']|["']$/g, "");
    if (trimmed) out.push(trimmed);
  }
  return out;
}

/**
 * Does this context-relative source resolve to something on disk under `base`?
 *
 * Globs are treated as satisfied when their non-glob prefix directory exists:
 * `packages/*\/package.json` under a root that has `packages/` is a match. A
 * glob whose prefix is missing entirely is a miss, which is exactly the signal
 * we want (`COPY packages/ ./packages/` inside `apps/web` where no
 * `apps/web/packages` exists).
 */
function sourceResolves(base: string, src: string): boolean {
  // Absolute / parent-escaping sources are not context reads we can reason
  // about; treat them as satisfied so they never drive an escalation.
  if (isAbsolute(src)) return true;
  const cleaned = src.replace(/^\.\//, "");
  if (cleaned === "." || cleaned === "") return true;
  if (normalize(cleaned).startsWith("..")) return true;

  const globAt = cleaned.search(/[*?[]/);
  if (globAt === -1) return existsSync(join(base, cleaned));

  // Everything before the last separator preceding the first glob char.
  const prefix = cleaned.slice(0, globAt);
  const lastSep = prefix.lastIndexOf("/");
  if (lastSep === -1) return true; // glob at the top level, e.g. `*.json`
  return existsSync(join(base, prefix.slice(0, lastSep)));
}

export interface ContextAnalysis {
  /** Sources that miss under the subdir but resolve from the repo root. */
  rootOnly: string[];
  /** Sources that resolve under neither (a genuinely broken Dockerfile). */
  unresolved: string[];
}

/**
 * Classify a subdir Dockerfile's COPY sources against both candidate contexts.
 * Pure apart from `existsSync` probes of the checked-out tree.
 */
export function analyzeCopySources(opts: {
  text: string;
  workDir: string;
  appDir: string;
}): ContextAnalysis {
  const rootOnly: string[] = [];
  const unresolved: string[] = [];
  for (const src of parseCopySources(opts.text)) {
    if (sourceResolves(opts.appDir, src)) continue;
    if (sourceResolves(opts.workDir, src)) rootOnly.push(src);
    else unresolved.push(src);
  }
  return { rootOnly, unresolved };
}

export interface ResolvedContext {
  /** Directory to hand buildx as the build context. */
  contextDir: string;
  /** Log line explaining a non-default choice, or null when nothing changed. */
  note: string | null;
}

/**
 * Pick the build context for a Dockerfile build.
 *
 * With no subdir there is only one candidate, so every mode collapses to the
 * repo root. With a subdir:
 *
 *   subdir → the app dir, unconditionally (pre-existing behavior)
 *   root   → the repo root, unconditionally
 *   auto   → the app dir, unless the Dockerfile COPYs something that only
 *            exists at the repo root AND the root is a workspace
 *
 * The workspace requirement keeps `auto` conservative: a root-only COPY in a
 * repo that isn't a workspace is far more likely to be a typo than a monorepo
 * build, and escalating would silently widen the context (and the image) for
 * a repo that never asked for it.
 */
export function resolveDockerfileContext(opts: {
  mode: DockerfileContext;
  workDir: string;
  appDir: string;
  /** Dockerfile contents, or null when unreadable (then `auto` = subdir). */
  dockerfileText: string | null;
  /** Repo root declares a package workspace (see `rootIsWorkspace`). */
  rootIsWorkspace: boolean;
}): ResolvedContext {
  const { workDir, appDir } = opts;
  if (resolve(workDir) === resolve(appDir)) return { contextDir: workDir, note: null };

  if (opts.mode === "subdir") return { contextDir: appDir, note: null };
  if (opts.mode === "root") {
    return {
      contextDir: workDir,
      note: "build context set to the repository root (build context: root)",
    };
  }

  if (!opts.dockerfileText || !opts.rootIsWorkspace) return { contextDir: appDir, note: null };

  const { rootOnly } = analyzeCopySources({
    text: opts.dockerfileText,
    workDir,
    appDir,
  });
  if (rootOnly.length === 0) return { contextDir: appDir, note: null };

  const shown = rootOnly.slice(0, 3).join(", ");
  const more = rootOnly.length > 3 ? `, +${rootOnly.length - 3} more` : "";
  return {
    contextDir: workDir,
    note:
      `monorepo Dockerfile: it COPYs ${shown}${more}, which exist only at the repository root. ` +
      "Building with the repository root as the build context instead of this service's root " +
      "directory. To choose manually, set Build context on the service's Source settings.",
  };
}

/**
 * Explain a buildx COPY failure that the context choice would have fixed.
 *
 * `auto` catches the detectable cases up front, but a Dockerfile can still miss
 * (a COPY source built by an earlier stage, a glob whose prefix happens to
 * exist). When buildx fails with a context-read error on a subdir build, say
 * which knob fixes it instead of leaving the operator with buildx's raw
 * "not found".
 */
const CONTEXT_FAILURE = /failed to compute cache key|not found|forbidden path outside/i;

export function contextFailureHint(opts: {
  tail: string;
  contextDir: string;
  workDir: string;
  subdir: string | null;
}): string | null {
  if (!opts.subdir || !CONTEXT_FAILURE.test(opts.tail)) return null;
  const atRoot = resolve(opts.contextDir) === resolve(opts.workDir);
  if (atRoot) {
    return (
      `The build context is the repository root, but a COPY could not be resolved. ` +
      `If this Dockerfile expects to be built from "${opts.subdir}", set Build context to ` +
      `"Root directory" on the service's Source settings.`
    );
  }
  return (
    `The build context is "${opts.subdir}", so COPY paths resolve against that folder, not the ` +
    `repository root. Monorepo Dockerfiles usually need the root (for the lockfile and sibling ` +
    `packages): set Build context to "Repository root" on the service's Source settings.`
  );
}

/** Dockerfile path relative to the chosen context, for logs. Falls back to the
 *  absolute path if the file somehow sits outside the context. */
export function relativeToContext(contextDir: string, dockerfilePath: string): string {
  const rel = resolve(dockerfilePath).slice(resolve(contextDir).length);
  return rel.startsWith(sep) ? rel.slice(1) : dockerfilePath;
}

/**
 * Sync twin of `rootIsWorkspace` (railpack-detect.ts), for the pure/sync
 * Dockerfile resolution path. Same signals: the `workspaces` field (npm/yarn/
 * bun array form or bun's `{ packages: [] }`) or pnpm-workspace.yaml.
 */
export function rootIsWorkspaceSync(workDir: string): boolean {
  if (existsSync(join(workDir, "pnpm-workspace.yaml"))) return true;
  const pkgPath = join(workDir, "package.json");
  if (!existsSync(pkgPath)) return false;
  const parsed = workspacePkgSchema.safeParse(
    Result.try((): unknown => JSON.parse(readFileSync(pkgPath, "utf8"))).unwrapOr(null),
  );
  if (!parsed.success) return false;
  const ws = parsed.data.workspaces;
  if (Array.isArray(ws)) return ws.length > 0;
  return (ws?.packages?.length ?? 0) > 0;
}
