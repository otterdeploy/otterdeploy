import { defineCommand } from "citty";

import { orAbsent, relativeTime } from "../lib/format";
import { resolveResource } from "../lib/resolve";
import {
  abort,
  confirm,
  detail,
  dim,
  interactive,
  note,
  ok,
  out,
  paint,
  panel,
  section,
  stateLabel,
  table,
  warn,
} from "../lib/ui";

// API contract: ttlMinutes int, min 5, max 10_080 (7 days), default 60.
const MIN_TTL_MINUTES = 5;
const MAX_TTL_MINUTES = 10_080;
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 1440;

function parseTtlMinutes(raw: string): number {
  const match = /^(\d+)\s*([mhd])?$/i.exec(raw.trim());
  const digits = match?.[1];
  if (!digits) {
    abort(`Invalid --ttl "${raw}".`, "use minutes, or a suffixed form like 15m, 2h, 1d");
  }
  const value = Number.parseInt(digits, 10);
  const unit = match?.[2]?.toLowerCase() ?? "m";
  const minutes =
    unit === "h" ? value * MINUTES_PER_HOUR : unit === "d" ? value * MINUTES_PER_DAY : value;
  if (minutes < MIN_TTL_MINUTES || minutes > MAX_TTL_MINUTES) {
    abort("--ttl must be between 5 minutes (5m) and 7 days (7d).");
  }
  return minutes;
}

/**
 * Connection URLs.
 *
 * Piped output keeps the original bare `label<space>url` lines so existing
 * scripts and `$(...)` captures keep working; a terminal gets the aligned block.
 */
function printUrls(pairs: Array<[string, string]>): void {
  if (interactive()) {
    detail(pairs);
    return;
  }
  for (const [label, url] of pairs) out(`${label}  ${url}`);
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
      abort("--ttl and --write only apply with --ephemeral.", "add `--ephemeral`");
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
      ok(`Minted a ${minted.scope} credential.`);
      section("Credential");
      detail([
        ["id", paint("id", minted.id)],
        ["role", dim(minted.roleName)],
        ["scope", minted.scope],
        ["expires", relativeTime(minted.expiresAt)],
      ]);
      // The password is inside these URLs and is never recoverable, so the
      // one-shot warning sits directly above them, not buried after.
      out();
      warn("Shown once. The password is not stored and cannot be re-fetched.");
      panel(
        [
          `internal  ${minted.internalUrl}`,
          ...(minted.publicUrl ? [`public    ${minted.publicUrl}`] : []),
        ].map((l) => dim(l)),
      );
      return;
    }

    const resource = await client.project.resource.get({ projectId, resourceId });
    if (resource.type !== "database") {
      abort(`${args.database} is a ${resource.type}, not a database.`);
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
    printUrls([
      ["internal", resource.internalConnectionString],
      ...(resource.publicEnabled
        ? ([["public", resource.publicConnectionString]] as Array<[string, string]>)
        : []),
    ]);
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
      note(`No ephemeral credentials for ${args.database}.`);
      return;
    }

    section(`Credentials ${dim(String(args.database))}`);
    table(
      [
        { header: "id" },
        { header: "scope" },
        { header: "status" },
        { header: "when" },
        { header: "label" },
      ],
      result.credentials.map((c) => [
        paint("id", c.id),
        dim(c.scope),
        stateLabel(c.status),
        // Which timestamp matters depends on the status. An active credential's
        // expiry, a revoked one's revocation.
        dim(
          c.status === "active"
            ? `expires ${relativeTime(c.expiresAt)}`
            : c.status === "revoked" && c.revokedAt
              ? `revoked ${relativeTime(c.revokedAt)}`
              : `expired ${relativeTime(c.expiresAt)}`,
        ),
        dim(orAbsent(c.label)),
      ]),
    );
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
      note(dim("Active sessions using this credential are terminated."));
      const proceed = await confirm(`Revoke ${args.credentialId} on ${resourceName}?`);
      if (!proceed) abort("Aborted. Nothing was revoked.");
    }
    const { revoked } = await client.database.ephemeralRevoke({
      resourceId,
      credentialId: args.credentialId,
    });
    if (revoked) ok(`Revoked ${args.credentialId}.`);
    else note(`${args.credentialId} was already revoked.`);
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
