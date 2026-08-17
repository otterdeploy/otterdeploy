#!/usr/bin/env bun
import type { CommandDef, Resolvable, SubCommandsDef } from "citty";

import { defineCommand, runMain } from "citty";

import type { CommandGroup } from "./lib/help";

import { addCommand } from "./commands/add";
import { auditCommand } from "./commands/audit";
import { backupsCommand } from "./commands/backups";
import { buildCommand } from "./commands/build";
import { completionsCommand, setCompletionRoot } from "./commands/completions";
import { dbCommand } from "./commands/db";
import { deployCommand } from "./commands/deploy";
import { deploymentsCommand } from "./commands/deployments";
import { domainsCommand } from "./commands/domains";
import { edgeCommand } from "./commands/edge";
import { envCommand } from "./commands/env";
import { environmentsCommand } from "./commands/environments";
import { execCommand } from "./commands/exec";
import { exportCommand } from "./commands/export";
import { initCommand } from "./commands/init";
import { loginCommand } from "./commands/login";
import { logoutCommand } from "./commands/logout";
import { logsCommand } from "./commands/logs";
import { metricsCommand } from "./commands/metrics";
import { openCommand } from "./commands/open";
import { orgCommand } from "./commands/org";
import { platformCommand } from "./commands/platform";
import { projectCommand } from "./commands/project";
import { pullCommand } from "./commands/pull";
import { redeployCommand } from "./commands/redeploy";
import { removeCommand } from "./commands/remove";
import { restartCommand } from "./commands/restart";
import { rollbackCommand } from "./commands/rollback";
import { statusCommand } from "./commands/status";
import { syncCommand } from "./commands/sync";
import { tokensCommand } from "./commands/tokens";
import { upCommand } from "./commands/up";
import { volumeCommand } from "./commands/volume";
import { whoamiCommand } from "./commands/whoami";
import { applyColorPreference } from "./lib/color";
import { wrapCommand } from "./lib/errors";
import { setCommandGroups, showUsage } from "./lib/help";
import { invokedName } from "./lib/name";
import { suggestions } from "./lib/suggest";
import { abort, out } from "./lib/ui";
import { CLI_VERSION } from "./version";

/**
 * Commands, grouped by the job the user is doing.
 *
 * This array is the single source of truth: `subCommands` is derived from it, so
 * a command cannot be registered without landing in a group, and help can never
 * list a command the parser doesn't accept. Adding a command to a group is the
 * whole registration step.
 *
 * Order is the order help prints them, which is roughly the order a user meets
 * them: sign in, set up a project, then operate it.
 */
const GROUPS: CommandGroup[] = [
  {
    title: "Auth & context",
    commands: {
      login: loginCommand,
      logout: logoutCommand,
      whoami: whoamiCommand,
      org: orgCommand,
      tokens: tokensCommand,
    },
  },
  {
    title: "Set up & deploy",
    commands: {
      init: initCommand,
      up: upCommand,
      add: addCommand,
      remove: removeCommand,
      deploy: deployCommand,
      sync: syncCommand,
      status: statusCommand,
      pull: pullCommand,
      export: exportCommand,
      project: projectCommand,
      open: openCommand,
    },
  },
  {
    title: "Operate services",
    commands: {
      restart: restartCommand,
      rollback: rollbackCommand,
      build: buildCommand,
      redeploy: redeployCommand,
      deployments: deploymentsCommand,
      logs: logsCommand,
      exec: execCommand,
      domains: domainsCommand,
      volume: volumeCommand,
      env: envCommand,
      environments: environmentsCommand,
    },
  },
  {
    title: "Data & backups",
    commands: {
      db: dbCommand,
      backups: backupsCommand,
    },
  },
  {
    title: "Observability & platform",
    commands: {
      metrics: metricsCommand,
      audit: auditCommand,
      edge: edgeCommand,
      platform: platformCommand,
    },
  },
  {
    title: "Shell",
    commands: {
      completions: completionsCommand,
    },
  },
];

const subCommands: SubCommandsDef = Object.assign({}, ...GROUPS.map((group) => group.commands));

const main = defineCommand({
  meta: {
    name: "otterdeploy",
    version: CLI_VERSION,
    description: "Deploy and operate otterdeploy projects from the terminal.",
  },
  subCommands,
});

setCommandGroups(GROUPS);
// The completions command renders itself from the live command tree.
setCompletionRoot(main);

const argv = process.argv.slice(2);
applyColorPreference(argv);

const positional = argv.filter((token) => !token.startsWith("-"));
const wantsHelp = argv.includes("--help") || argv.includes("-h");

// Genuine narrowing: every T resolved here (SubCommandsDef, CommandDef) is a
// plain object, so a function value can only be the thunk arm of Resolvable.
function isThunk<T>(value: Resolvable<T>): value is (() => T) | (() => Promise<T>) {
  return typeof value === "function";
}

async function resolve<T>(value: Resolvable<T>): Promise<T> {
  return isThunk(value) ? await value() : await value;
}

async function subsOf(cmd: CommandDef): Promise<SubCommandsDef | null> {
  const subs = await resolve<SubCommandsDef | undefined>(cmd.subCommands);
  return subs && Object.keys(subs).length > 0 ? subs : null;
}

/**
 * Walk the typed path through the command tree.
 *
 * Aborts on the first token that isn't a real command, with suggestions scoped
 * to *that* level: `otd domains frobnicate` is compared against domains' five
 * subcommands, not against the 34 top-level ones.
 *
 * Returns the group whose help should be shown when the path stops on a group
 * that has no `run` of its own (`otd domains`), which is a request to see what
 * that group contains rather than an error.
 */
async function walkCommandPath(): Promise<{ group: CommandDef } | null> {
  const bin = invokedName();
  let level: SubCommandsDef = subCommands;
  let current: CommandDef | null = null;
  const walked: string[] = [];

  for (const token of positional) {
    const match = level[token];
    if (match !== undefined) {
      current = await resolve(match);
      const subs = await subsOf(current);
      if (!subs) return null; // a leaf, so every remaining token is one of its args
      walked.push(token);
      level = subs;
      continue;
    }
    const scope = walked.length > 0 ? `${bin} ${walked.join(" ")}` : bin;
    const near = suggestions(token, Object.keys(level));
    abort(
      `Unknown command \`${token}\`${walked.length > 0 ? ` for \`${scope}\`` : ""}.`,
      ...near.map((candidate) => `did you mean \`${scope} ${candidate}\`?`),
      `run \`${scope} --help\` to list commands`,
    );
  }

  // Path consumed and we're standing on a group. citty would throw
  // `No command specified.` here, printing help *and* an error; showing the
  // group's commands at exit 0 is the honest answer to `otd domains`.
  return current && !current.run ? { group: current } : null;
}

/**
 * Preflight, before handing off to citty, for the cases citty routes through
 * its error path: where it prints the full help text followed by a raw
 * `CLIError` message and a misleading exit code.
 *
 *   bare invocation   root help on stdout, exit 0, asking for help isn't an error
 *   -v / --version    the version alone, so `$(otd -v)` is usable
 *   unknown command   one line naming the closest real command, exit 1
 *   bare group        that group's commands, exit 0
 */
async function preflight(): Promise<void> {
  if (!wantsHelp && positional.length === 0) {
    if (argv.includes("--version") || argv.includes("-v")) {
      out(CLI_VERSION);
      process.exit(0);
    }
    // Bare, or flags only: there is no root command to run.
    await showUsage(main);
    process.exit(0);
  }

  // `--help` is valid at every depth and never an error, so it bypasses the
  // unknown-token check and falls through to citty's help dispatch.
  if (wantsHelp) return;

  const stopped = await walkCommandPath();
  if (stopped) {
    await showUsage(stopped.group);
    process.exit(0);
  }
}

await preflight();

// Every leaf command runs inside the shared error boundary (friendly messages,
// 401 re-auth, non-zero exit): see lib/errors.ts. `showUsage` replaces citty's
// renderer with the grouped one in lib/help.ts.
void runMain(wrapCommand(main), { showUsage });
