import { defineCommand } from "citty";
import { consola } from "consola";

import { ensureAuthenticated } from "../auth-flow";
import { createCliClient } from "../client";
import { resolveResource } from "../lib/resolve";

function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return "—";
  let value = bytes;
  let unit = "B";
  for (const next of ["KB", "MB", "GB", "TB"]) {
    if (value < 1024) break;
    value /= 1024;
    unit = next;
  }
  return `${value >= 10 || unit === "B" ? Math.round(value) : value.toFixed(1)} ${unit}`;
}

function age(ts: Date | string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
}

// `bak_` + first 8 chars of the cuid — enough to eyeball; restore
// resolves prefixes, and `--json` carries the full ids.
function shortId(id: string): string {
  return id.length > 12 ? id.slice(0, 12) : id;
}

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
      consola.info("No backups found.");
      return;
    }
    for (const b of backups) {
      const size = formatBytes(b.compressedSizeBytes ?? b.sourceSizeBytes);
      const row = [
        shortId(b.id),
        (b.source ?? "?").padEnd(16),
        b.status.padEnd(10),
        (b.destinationName ?? "?").padEnd(14),
        size.padEnd(9),
        age(b.createdAt),
      ].join("  ");
      consola.log(row);
    }
  },
});

const runCmd = defineCommand({
  meta: { name: "run", description: "Run a manual backup of a database now" },
  args: {
    database: { type: "positional", required: true, description: "Database name" },
    destination: { type: "string", description: "Destination id (bakdest_…)" },
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
        consola.error("No backup destinations configured — create one first.");
        process.exit(1);
      }
      if (!only) {
        consola.error("Several destinations exist — pick one with --destination <id>:");
        for (const d of destinations) consola.log(`  ${d.id}  ${d.name} (${d.type})`);
        process.exit(1);
      }
      destinationId = only.id;
      consola.info(`Using the only destination: ${only.name} (${only.id}).`);
    }

    const result = await client.backups.run({ resourceId, destinationIds: [destinationId] });
    consola.success(`Backup ${result.ids.join(", ")} queued for ${resourceName}.`);
    consola.info("Watch progress with `otterdeploy backups list`.");
  },
});

const restoreCmd = defineCommand({
  meta: {
    name: "restore",
    description: "Restore a backup in place — OVERWRITES the live database",
  },
  args: {
    backupId: { type: "positional", required: true, description: "Backup id (bak_…, prefix ok)" },
    confirm: {
      type: "string",
      description: "Confirmation phrase (the database name) for non-interactive use",
    },
    url: { type: "string", description: "Override control plane URL" },
  },
  async run({ args }) {
    const { url, token } = await ensureAuthenticated(args.url);
    const client = createCliClient({ url, token });

    const backups = await client.backups.list({});
    const matches = backups.filter((b) => b.id.startsWith(args.backupId));
    const exact = backups.find((b) => b.id === args.backupId);
    const backup = exact ?? (matches.length === 1 ? matches[0] : undefined);
    if (!backup) {
      if (matches.length > 1) {
        consola.error(`"${args.backupId}" matches ${matches.length} backups — use a longer id:`);
        for (const m of matches.slice(0, 10)) {
          consola.log(`  ${m.id}  ${m.source ?? "?"} (${age(m.createdAt)})`);
        }
      } else {
        consola.error(`Backup ${args.backupId} not found in this organization.`);
      }
      process.exit(1);
    }
    if (backup.status !== "succeeded") {
      consola.error(`Backup ${backup.id} is ${backup.status} — only succeeded backups restore.`);
      process.exit(1);
    }

    const expected = backup.source ?? backup.resourceId;
    consola.warn(`In-place restore OVERWRITES database "${expected}" from backup ${backup.id}.`);
    consola.info(`Backup taken ${age(backup.createdAt)}.`);

    // The API demands a typed confirmation (resource name or id) for
    // in-place restores; there is deliberately no --yes bypass here.
    let confirm = args.confirm;
    if (!confirm) {
      if (!process.stdin.isTTY) {
        consola.error(`Non-interactive session — pass --confirm "${expected}" to proceed.`);
        process.exit(1);
      }
      confirm = (await consola.prompt(`Type "${expected}" to confirm:`, {
        type: "text",
      })) as string;
    }
    if (confirm !== expected && confirm !== backup.resourceId) {
      consola.error("Confirmation did not match — aborted, nothing restored.");
      process.exit(1);
    }

    const result = await client.backups.restore({ id: backup.id, mode: "in-place", confirm });
    if (result.ok) consola.success(`Restored ${expected} from ${backup.id}.`);
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
      consola.info("No backup destinations configured.");
      return;
    }
    for (const d of destinations) {
      const row = [
        d.id,
        d.name.padEnd(20),
        d.type.padEnd(6),
        formatBytes(d.usedBytes).padEnd(9),
        d.status,
      ].join("  ");
      consola.log(row);
    }
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
    restore: restoreCmd,
    destinations: destinationsCmd,
  },
});
