import { defineCommand } from "citty";

import { ensureAuthenticated } from "../auth-flow";
import { createCliClient } from "../client";
import { formatBytes, orAbsent, relativeTime, shortId } from "../lib/format";
import { cmd } from "../lib/name";
import { resolveResource } from "../lib/resolve";
import {
  abort,
  detail,
  dim,
  err,
  hint,
  note,
  ok,
  paint,
  row,
  section,
  stateLabel,
  table,
} from "../lib/ui";
import { restoreBackupCommand, verifyBackupCommand } from "./backups-restore";

const listCmd = defineCommand({
  meta: { name: "list", description: "List backup runs (org-wide)" },
  args: {
    database: { type: "string", description: "Filter to one database by name" },
    limit: { type: "string", description: "Show at most N runs" },
    config: { type: "string", description: "Path to config file" },
    slug: { type: "string", description: "Project slug (defaults to config)" },
    url: { type: "string", description: "Override control plane URL" },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    let backups;
    if (args.database) {
      const ctx = await resolveResource(args, args.database, "database");
      const all = await ctx.client.backups.list({ projectId: ctx.projectId });
      backups = all.filter((b) => b.resourceId === ctx.resourceId);
    } else {
      const { url, token } = await ensureAuthenticated(args.url);
      const client = createCliClient({ url, token });
      backups = await client.backups.list({});
    }
    const limit = args.limit ? Number.parseInt(args.limit, 10) : Number.NaN;
    if (Number.isFinite(limit) && limit > 0) backups = backups.slice(0, limit);

    if (args.json) {
      process.stdout.write(`${JSON.stringify(backups, null, 2)}\n`);
      return;
    }
    if (backups.length === 0) {
      note("No backups found.");
      hint(`run \`${cmd("backups run <database>")}\` to take one`);
      return;
    }

    section("Backups");
    table(
      [
        { header: "id" },
        { header: "source" },
        { header: "status" },
        { header: "destination" },
        { header: "size", align: "right" },
        { header: "taken" },
      ],
      backups.map((b) => [
        paint("id", shortId(b.id)),
        orAbsent(b.source),
        stateLabel(b.status),
        dim(orAbsent(b.destinationName)),
        dim(formatBytes(b.compressedSizeBytes ?? b.sourceSizeBytes)),
        dim(relativeTime(String(b.createdAt))),
      ]),
    );
  },
});

const runCmd = defineCommand({
  meta: { name: "run", description: "Run a manual backup of a database now" },
  args: {
    database: { type: "positional", required: true, description: "Database name" },
    destination: { type: "string", description: "Destination id (bakdest_…)" },
    physical: {
      type: "boolean",
      description: "pg_basebackup cluster tar instead of a logical dump (postgres only)",
    },
    config: { type: "string", description: "Path to config file" },
    slug: { type: "string", description: "Project slug (defaults to config)" },
    url: { type: "string", description: "Override control plane URL" },
  },
  async run({ args }) {
    const { client, resourceId, resourceName } = await resolveResource(
      args,
      args.database,
      "database",
    );

    let destinationId = args.destination;
    if (!destinationId) {
      const destinations = await client.backups.destinations.list({});
      const only = destinations.length === 1 ? destinations[0] : undefined;
      if (destinations.length === 0) {
        abort(
          "No backup destinations configured.",
          "add one in the dashboard under Backups → Destinations",
        );
      }
      if (!only) {
        // The choices must print BEFORE the abort. `abort` exits, so anything
        // after it would never reach the terminal.
        err();
        for (const d of destinations) {
          row([paint("id", d.id), d.name, dim(`(${d.type})`)]);
        }
        err();
        abort(`${destinations.length} destinations exist. Pick one.`, "pass `--destination <id>`");
      }
      destinationId = only.id;
      note(`Using the only destination: ${only.name} ${dim(`(${only.id})`)}.`);
    }

    const result = await client.backups.run({
      resourceId,
      destinationIds: [destinationId],
      approach: args.physical ? "physical" : "logical",
    });
    ok(`${args.physical ? "Physical backup" : "Backup"} queued for ${resourceName}.`);
    detail([["id", result.ids.map((id) => paint("id", shortId(id))).join(" ")]]);
    hint(`run \`${cmd("backups list")}\` to watch progress`);
  },
});

const destinationsListCmd = defineCommand({
  meta: { name: "list", description: "List backup destinations" },
  args: {
    url: { type: "string", description: "Override control plane URL" },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    const { url, token } = await ensureAuthenticated(args.url);
    const client = createCliClient({ url, token });
    const destinations = await client.backups.destinations.list({});
    if (args.json) {
      process.stdout.write(`${JSON.stringify(destinations, null, 2)}\n`);
      return;
    }
    if (destinations.length === 0) {
      note("No backup destinations configured.");
      return;
    }

    section("Destinations");
    table(
      [
        { header: "id" },
        { header: "name" },
        { header: "type" },
        { header: "used", align: "right" },
        { header: "status" },
      ],
      destinations.map((d) => [
        paint("id", d.id),
        d.name,
        dim(d.type),
        dim(formatBytes(d.usedBytes)),
        stateLabel(d.status),
      ]),
    );
  },
});

const destinationsCmd = defineCommand({
  meta: { name: "destinations", description: "Backup destinations" },
  subCommands: {
    list: destinationsListCmd,
  },
});

export const backupsCommand = defineCommand({
  meta: { name: "backups", description: "Run, list, and restore database backups" },
  subCommands: {
    list: listCmd,
    run: runCmd,
    restore: restoreBackupCommand,
    verify: verifyBackupCommand,
    destinations: destinationsCmd,
  },
});
