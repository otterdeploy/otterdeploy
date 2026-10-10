import {
  API_KEY_MAX_EXPIRES_IN_SECONDS,
  API_KEY_MIN_EXPIRES_IN_SECONDS,
} from "@otterdeploy/shared/api-key-expiry";
import { defineCommand } from "citty";

import { ensureAuthenticated } from "../auth-flow";
import { createCliClient } from "../client";
import { relativeTime } from "../lib/format";
import { abort, bold, detail, dim, ok, paint, panel, section, warn } from "../lib/ui";

const SECONDS_PER_DAY = 86_400;
const SECONDS_PER_HOUR = 3_600;

// "90d" | "12h" | "30m" → seconds; "never" → null (non-expiring key).
function parseExpires(raw: string): number | null {
  if (raw === "never") return null;
  const match = /^(\d+)([dhm])$/.exec(raw);
  const amount = Number(match?.[1]);
  if (!match || amount <= 0) {
    abort(`Invalid --expires "${raw}".`, 'use <N>d, <N>h, <N>m (e.g. 90d), or "never"');
  }
  const unit = match[2] === "d" ? SECONDS_PER_DAY : match[2] === "h" ? SECONDS_PER_HOUR : 60;
  const seconds = amount * unit;
  // The server's range, said here before the round trip.
  if (seconds < API_KEY_MIN_EXPIRES_IN_SECONDS || seconds > API_KEY_MAX_EXPIRES_IN_SECONDS) {
    abort(
      `Invalid --expires "${raw}": a key lives between 1 day and 365 days.`,
      'for example `--expires 90d`, or "never"',
    );
  }
  return seconds;
}

// citty doesn't collect repeated string flags into an array (last one wins),
// so `--project a --project b` has to be recovered from rawArgs.
function collectRepeated(rawArgs: string[], flag: string, example: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === flag) {
      const next = rawArgs[i + 1];
      if (!next || next.startsWith("-")) {
        abort(`${flag} requires a value.`, `for example \`${flag} ${example}\``);
      }
      values.push(next);
      i++;
    } else if (arg?.startsWith(`${flag}=`)) {
      values.push(arg.slice(flag.length + 1));
    }
  }
  return [...new Set(values)];
}

// `--scope service:deploy --scope service:read` -> { service: ["deploy", "read"] }.
// Whether a key may hold each pair is the server's call (it refuses anything a
// key could never use); here only the shape is checked.
function parseScopes(scopes: string[]): Record<string, string[]> {
  const permissions: Record<string, string[]> = {};
  for (const scope of scopes) {
    const match = /^([A-Za-z]+):([A-Za-z]+)$/.exec(scope);
    const resource = match?.[1];
    const action = match?.[2];
    if (!resource || !action) {
      abort(`Invalid --scope "${scope}".`, "use <resource>:<action>, e.g. service:deploy");
    }
    permissions[resource] = [...(permissions[resource] ?? []), action];
  }
  return permissions;
}

const ACCESS_HINT =
  "pass --scope <resource>:<action> (repeatable, e.g. --scope service:deploy), or --full-access";

const createToken = defineCommand({
  meta: { name: "create", description: "Create an API key for CI and scripts" },
  args: {
    name: { type: "string", required: true, description: "Key name" },
    expires: {
      type: "string",
      default: "90d",
      description: 'Expiry: <N>d, <N>h, <N>m, or "never"',
    },
    scope: {
      type: "string",
      description: "Grant one permission, <resource>:<action> (repeatable, e.g. service:deploy)",
    },
    "full-access": {
      type: "boolean",
      description: "Grant everything a workspace member may do, instead of --scope",
    },
    "read-only": { type: "boolean", description: "Restrict the key to read operations" },
    project: {
      type: "string",
      description: "Limit the key to a project slug (repeatable)",
    },
    url: { type: "string", description: "Override control plane URL" },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args, rawArgs }) {
    const expiresIn = parseExpires(args.expires);
    const projectSlugs = collectRepeated(rawArgs, "--project", "storefront");
    // What the key may do is an explicit choice: no flags used to mean full
    // access, so a key made in a hurry was the most powerful kind.
    const scopes = collectRepeated(rawArgs, "--scope", "service:deploy");
    const fullAccess = args["full-access"] === true;
    if (fullAccess && scopes.length > 0) {
      abort("Choose either --scope or --full-access, not both.", ACCESS_HINT);
    }
    if (!fullAccess && scopes.length === 0) {
      abort("Choose what the key may do.", ACCESS_HINT);
    }
    const permissions = fullAccess ? ("full" as const) : parseScopes(scopes);

    const { url, token } = await ensureAuthenticated(args.url);
    const client = createCliClient({ url, token });

    const projectIds = await Promise.all(
      projectSlugs.map(async (slug) => (await client.project.getBySlug({ slug })).id),
    );

    const created = await client.apiKeys.create({
      name: args.name,
      expiresIn,
      permissions,
      ...(args["read-only"] ? { accessLevel: "read" as const } : {}),
      ...(projectIds.length > 0 ? { projectScope: "selected" as const, projectIds } : {}),
    });

    if (args.json) {
      process.stdout.write(`${JSON.stringify(created, null, 2)}\n`);
      return;
    }

    ok(`Created API key ${args.name}.`);
    section("Key");
    detail([
      ["access", fullAccess ? paint("warn", "full") : scopes.join(", ")],
      ["mode", args["read-only"] ? "read-only" : "read-write"],
      [
        "projects",
        projectSlugs.length > 0 ? projectSlugs.join(", ") : dim("all in this organization"),
      ],
      // A never-expiring key is a standing risk, so it reads as a warning
      // rather than as an ordinary value.
      [
        "expires",
        created.expiresAt ? relativeTime(created.expiresAt.toISOString()) : paint("warn", "never"),
      ],
    ]);

    warn("Copy the key now. It is not stored and cannot be shown again.");
    panel([bold(paint("accent", created.key)), "", dim(`export OTTERDEPLOY_TOKEN=${created.key}`)]);
  },
});

export const tokensCommand = defineCommand({
  meta: { name: "tokens", description: "Manage API keys" },
  subCommands: {
    create: createToken,
  },
});
