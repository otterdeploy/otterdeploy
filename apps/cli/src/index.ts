#!/usr/bin/env bun
import { defineCommand, runMain } from "citty";

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
import { removeCommand } from "./commands/remove";
import { restartCommand } from "./commands/restart";
import { rollbackCommand } from "./commands/rollback";
import { statusCommand } from "./commands/status";
import { syncCommand } from "./commands/sync";
import { tokensCommand } from "./commands/tokens";
import { upCommand } from "./commands/up";
import { whoamiCommand } from "./commands/whoami";
import { applyColorPreference } from "./lib/color";
import { wrapCommand } from "./lib/errors";
import { CLI_VERSION } from "./version";

const main = defineCommand({
  meta: {
    name: "otterdeploy",
    version: CLI_VERSION,
    description: "Deploy and operate otterdeploy projects from the terminal",
  },
  subCommands: {
    // ─── Auth & context ──────────────────────────────────────────────
    login: loginCommand,
    logout: logoutCommand,
    whoami: whoamiCommand,
    org: orgCommand,
    tokens: tokensCommand,
    // ─── Project lifecycle ───────────────────────────────────────────
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
    // ─── Day-2 service ops ───────────────────────────────────────────
    restart: restartCommand,
    rollback: rollbackCommand,
    build: buildCommand,
    deployments: deploymentsCommand,
    logs: logsCommand,
    exec: execCommand,
    domains: domainsCommand,
    env: envCommand,
    environments: environmentsCommand,
    // ─── Data & backups ──────────────────────────────────────────────
    db: dbCommand,
    backups: backupsCommand,
    // ─── Observability & platform ────────────────────────────────────
    metrics: metricsCommand,
    audit: auditCommand,
    edge: edgeCommand,
    platform: platformCommand,
    // ─── Meta ────────────────────────────────────────────────────────
    completions: completionsCommand,
  },
});

// The completions command renders itself from the live command tree.
setCompletionRoot(main);

applyColorPreference(process.argv.slice(2));

// Every leaf command runs inside the shared error boundary (friendly messages,
// 401 re-auth, non-zero exit) — see lib/errors.ts.
void runMain(wrapCommand(main));
