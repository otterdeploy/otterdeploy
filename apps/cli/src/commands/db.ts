import { defineCommand } from "citty";
import { consola } from "consola";

import { resolveResource } from "../lib/resolve";

// API contract: ttlMinutes int, min 5, max 10_080 (7 days), default 60.
function parseTtlMinutes(raw: string): number {
  const match = /^(\d+)\s*([mhd])?$/i.exec(raw.trim());
  const digits = match?.[1];
  if (!digits) {
    consola.error(`Invalid --ttl "${raw}". Use minutes or a suffixed form like 15m, 2h, 1d.`);
    process.exit(1);
  }
  const value = Number.parseInt(digits, 10);
  const unit = match?.[2]?.toLowerCase() ?? "m";
  const minutes = unit === "h" ? value * 60 : unit === "d" ? value * 1440 : value;
  if (minutes < 5 || minutes > 10_080) {
    consola.error("--ttl must be between 5 minutes (5m) and 7 days (7d).");
    process.exit(1);
  }
  return minutes;
}

function relativeTime(iso: string): string {
  const delta = new Date(iso).getTime() - Date.now();
  const minutes = Math.max(1, Math.round(Math.abs(delta) / 60_000));
  const human =
    minutes < 60
      ? `${minutes}m`
      : minutes < 1440
        ? `${Math.round(minutes / 60)}h`
        : `${Math.round(minutes / 1440)}d`;
  return delta >= 0 ? `in ${human}` : `${human} ago`;
}

const urlCmd = defineCommand({
  meta: { name: "url", description: "Print connection URLs for a database" },
  args: {
    database: { type: "positional", required: true, description: "Database name" },
    ephemeral: {
      type: "boolean",
      description: "Mint a short-lived credential instead of the standing one",
    },
    ttl: { type: "string", description: "Ephemeral lifetime: minutes or 15m/2h/1d (default 1h)" },
    write: { type: "boolean", description: "Mint with read-write scope (default read-only)" },
    config: { type: "string", description: "Path to config file" },
    slug: { type: "string", description: "Project slug (defaults to config)" },
    url: { type: "string", description: "Override control plane URL" },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    if ((args.ttl || args.write) && !args.ephemeral) {
      consola.error("--ttl and --write only apply with --ephemeral.");
      process.exit(1);
    }
    const { client, projectId, resourceId } = await resolveResource(
      args,
      args.database,
      "database",
    );

    if (args.ephemeral) {
      const minted = await client.database.ephemeralCreate({
        resourceId,
        scope: args.write ? "read-write" : "read-only",
        ...(args.ttl ? { ttlMinutes: parseTtlMinutes(args.ttl) } : {}),
      });
      if (args.json) {
        process.stdout.write(`${JSON.stringify(minted, null, 2)}\n`);
        return;
      }
      consola.success(`Minted ${minted.scope} credential ${minted.id} (role ${minted.roleName}).`);
      consola.warn("Shown once — the password is never stored and cannot be re-fetched.");
      consola.info(`Expires ${minted.expiresAt} (${relativeTime(minted.expiresAt)}).`);
      consola.log(`internal  ${minted.internalUrl}`);
      if (minted.publicUrl) consola.log(`public    ${minted.publicUrl}`);
      return;
    }

    const resource = await client.project.resource.get({ projectId, resourceId });
    if (resource.type !== "database") {
      consola.error(`${args.database} is a ${resource.type}, not a database.`);
      process.exit(1);
    }
    if (args.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            name: resource.name,
            engine: resource.engine,
            internalConnectionString: resource.internalConnectionString,
            publicEnabled: resource.publicEnabled,
            publicConnectionString: resource.publicEnabled ? resource.publicConnectionString : null,
          },
          null,
          2,
        )}\n`,
      );
      return;
    }
    consola.log(`internal  ${resource.internalConnectionString}`);
    if (resource.publicEnabled) consola.log(`public    ${resource.publicConnectionString}`);
  },
});

const credsList = defineCommand({
  meta: { name: "list", description: "List ephemeral credentials for a database" },
  args: {
    database: { type: "positional", required: true, description: "Database name" },
    config: { type: "string", description: "Path to config file" },
    slug: { type: "string", description: "Project slug (defaults to config)" },
    url: { type: "string", description: "Override control plane URL" },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    const { client, resourceId } = await resolveResource(args, args.database, "database");
    const result = await client.database.ephemeralList({ resourceId });
    if (args.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    if (result.credentials.length === 0) {
      consola.info(`No ephemeral credentials for ${args.database}.`);
      return;
    }
    for (const c of result.credentials) {
      const when =
        c.status === "active"
          ? `expires ${relativeTime(c.expiresAt)}`
          : c.status === "revoked" && c.revokedAt
            ? `revoked ${relativeTime(c.revokedAt)}`
            : `expired ${relativeTime(c.expiresAt)}`;
      const row = [c.id, c.scope.padEnd(10), c.status.padEnd(8), when.padEnd(18), c.label ?? ""]
        .join("  ")
        .trimEnd();
      consola.log(row);
    }
  },
});

const credsRevoke = defineCommand({
  meta: { name: "revoke", description: "Revoke an ephemeral credential (drops the pg role)" },
  args: {
    database: { type: "positional", required: true, description: "Database name" },
    credentialId: { type: "positional", required: true, description: "Credential id (dbeph_…)" },
    yes: { type: "boolean", description: "Skip the confirmation prompt" },
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
    if (!args.yes) {
      const ok = await consola.prompt(
        `Revoke ${args.credentialId} on ${resourceName}? Active sessions are terminated.`,
        { type: "confirm", initial: false },
      );
      if (!ok) {
        consola.info("Aborted.");
        return;
      }
    }
    const { revoked } = await client.database.ephemeralRevoke({
      resourceId,
      credentialId: args.credentialId,
    });
    if (revoked) consola.success(`Revoked ${args.credentialId}.`);
    else consola.info(`${args.credentialId} was already revoked.`);
  },
});

const credsCommand = defineCommand({
  meta: { name: "creds", description: "Manage ephemeral database credentials" },
  subCommands: {
    list: credsList,
    revoke: credsRevoke,
  },
});

export const dbCommand = defineCommand({
  meta: { name: "db", description: "Database connection URLs and credentials" },
  subCommands: {
    url: urlCmd,
    creds: credsCommand,
  },
});
