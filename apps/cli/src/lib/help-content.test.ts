/**
 * Keeps `--help` examples honest.
 *
 * A worked example that names a flag the command no longer accepts is worse
 * than no example: it fails when copy-pasted and teaches the wrong thing. These
 * walk the live command tree and check every example against it, so renaming a
 * flag breaks the build instead of quietly breaking the docs.
 */

import type { CommandDef, Resolvable, SubCommandsDef } from "citty";

import { describe, expect, it } from "vite-plus/test";

import { EXAMPLES } from "./help-content";

/** A command as it sits in a `SubCommandsDef` slot (citty types these loosely). */
type SubCommand = SubCommandsDef[string];

/** citty values are `Resolvable`: plain, promised, or thunked. The commands
 *  here are all object-shaped, so `typeof === "function"` can only be the
 *  thunk arm, which makes this a sound narrowing. */
function isThunk<T>(value: Resolvable<T>): value is (() => T) | (() => Promise<T>) {
  return typeof value === "function";
}

async function resolve<T>(value: Resolvable<T>): Promise<T> {
  return isThunk(value) ? await value() : await value;
}

/** The real root command, imported lazily so the module graph stays cheap. */
async function loadRoot(): Promise<SubCommandsDef> {
  // Rebuilding the group list here would duplicate index.ts; instead import the
  // command modules the examples actually reference, keyed by their path root.
  const loaders: ReadonlyArray<readonly [string, () => Promise<SubCommand>]> = [
    ["add", () => import("../commands/add").then((m) => m.addCommand)],
    ["audit", () => import("../commands/audit").then((m) => m.auditCommand)],
    ["backups", () => import("../commands/backups").then((m) => m.backupsCommand)],
    ["build", () => import("../commands/build").then((m) => m.buildCommand)],
    ["completions", () => import("../commands/completions").then((m) => m.completionsCommand)],
    ["db", () => import("../commands/db").then((m) => m.dbCommand)],
    ["deploy", () => import("../commands/deploy").then((m) => m.deployCommand)],
    ["deployments", () => import("../commands/deployments").then((m) => m.deploymentsCommand)],
    ["domains", () => import("../commands/domains").then((m) => m.domainsCommand)],
    ["edge", () => import("../commands/edge").then((m) => m.edgeCommand)],
    ["env", () => import("../commands/env").then((m) => m.envCommand)],
    ["environments", () => import("../commands/environments").then((m) => m.environmentsCommand)],
    ["exec", () => import("../commands/exec").then((m) => m.execCommand)],
    ["export", () => import("../commands/export").then((m) => m.exportCommand)],
    ["init", () => import("../commands/init").then((m) => m.initCommand)],
    ["login", () => import("../commands/login").then((m) => m.loginCommand)],
    ["logs", () => import("../commands/logs").then((m) => m.logsCommand)],
    ["metrics", () => import("../commands/metrics").then((m) => m.metricsCommand)],
    ["open", () => import("../commands/open").then((m) => m.openCommand)],
    ["org", () => import("../commands/org").then((m) => m.orgCommand)],
    ["platform", () => import("../commands/platform").then((m) => m.platformCommand)],
    ["project", () => import("../commands/project").then((m) => m.projectCommand)],
    ["pull", () => import("../commands/pull").then((m) => m.pullCommand)],
    ["redeploy", () => import("../commands/redeploy").then((m) => m.redeployCommand)],
    ["restart", () => import("../commands/restart").then((m) => m.restartCommand)],
    ["rollback", () => import("../commands/rollback").then((m) => m.rollbackCommand)],
    ["status", () => import("../commands/status").then((m) => m.statusCommand)],
    ["sync", () => import("../commands/sync").then((m) => m.syncCommand)],
    ["tokens", () => import("../commands/tokens").then((m) => m.tokensCommand)],
    ["up", () => import("../commands/up").then((m) => m.upCommand)],
    ["volume", () => import("../commands/volume").then((m) => m.volumeCommand)],
  ];
  const entries = await Promise.all(
    loaders.map(async ([name, load]) => [name, await load()] as const),
  );
  return Object.fromEntries(entries);
}

/** Resolve a space-separated example key to its command, or null. */
async function commandAt(root: SubCommandsDef, path: string[]): Promise<CommandDef | null> {
  let level: SubCommandsDef | null = root;
  let current: CommandDef | null = null;
  for (const token of path) {
    const next: SubCommand | undefined = level?.[token];
    if (next === undefined) return null;
    current = await resolve(next);
    level = (await resolve(current.subCommands)) ?? null;
  }
  return current;
}

/** Long flags a command accepts, including the `--no-` form of true-defaults. */
async function acceptedFlags(cmd: CommandDef): Promise<Set<string>> {
  const args = (await resolve(cmd.args)) ?? {};
  const flags = new Set<string>(["--help", "--json"]);
  for (const [name, def] of Object.entries(args)) {
    if (def.type === "positional") continue;
    flags.add(`--${name}`);
    if (def.type === "boolean" && def.default === true) flags.add(`--no-${name}`);
  }
  return flags;
}

describe("help examples", () => {
  it("every example targets a command that exists", async () => {
    const root = await loadRoot();
    const missing: string[] = [];
    for (const key of Object.keys(EXAMPLES)) {
      if (!(await commandAt(root, key.split(" ")))) missing.push(key);
    }
    expect(missing).toEqual([]);
  });

  it("every example's `run` starts with its own command path", async () => {
    const wrong: string[] = [];
    for (const [key, examples] of Object.entries(EXAMPLES)) {
      for (const example of examples) {
        if (!example.run.startsWith(key)) wrong.push(`${key}: ${example.run}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("every flag an example names is actually accepted", async () => {
    const root = await loadRoot();
    const unknown: string[] = [];
    for (const [key, examples] of Object.entries(EXAMPLES)) {
      const cmd = await commandAt(root, key.split(" "));
      if (!cmd) continue;
      const flags = await acceptedFlags(cmd);
      for (const example of examples) {
        for (const token of example.run.split(/\s+/)) {
          if (!token.startsWith("--")) continue;
          const flag = token.split("=")[0] ?? token;
          if (!flags.has(flag)) unknown.push(`${key}: ${flag}`);
        }
      }
    }
    expect(unknown).toEqual([]);
  });

  it("notes read as lower-case fragments, not sentences", async () => {
    const bad: string[] = [];
    for (const [key, examples] of Object.entries(EXAMPLES)) {
      for (const { note } of examples) {
        if (note.endsWith(".")) bad.push(`${key}: trailing period`);
        if (note[0] && note[0] !== note[0].toLowerCase()) bad.push(`${key}: leading capital`);
      }
    }
    expect(bad).toEqual([]);
  });
});
