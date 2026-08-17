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
  return amount * unit;
}

// citty doesn't collect repeated string flags into an array (last one wins),
// so `--project a --project b` has to be recovered from rawArgs.
function collectProjectSlugs(rawArgs: string[]): string[] {
  const slugs: string[] = [];
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === "--project") {
      const next = rawArgs[i + 1];
      if (!next || next.startsWith("-")) {
        abort("--project requires a project slug.", "for example `--project storefront`");
      }
      slugs.push(next);
      i++;
    } else if (arg?.startsWith("--project=")) {
      slugs.push(arg.slice("--project=".length));
    }
  }
  return [...new Set(slugs)];
}

const createToken = defineCommand({
  meta: { name: "create", description: "Create an API key for CI and scripts" },
  args: {
    name: { type: "string", required: true, description: "Key name" },
    expires: {
      type: "string",
      default: "90d",
      description: 'Expiry: <N>d, <N>h, <N>m, or "never"',
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
    const projectSlugs = collectProjectSlugs(rawArgs);

    const { url, token } = await ensureAuthenticated(args.url);
    const client = createCliClient({ url, token });

    const projectIds = await Promise.all(
      projectSlugs.map(async (slug) => (await client.project.getBySlug({ slug })).id),
    );

    const created = await client.apiKeys.create({
      name: args.name,
      expiresIn,
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
      ["scope", args["read-only"] ? "read-only" : "read-write"],
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
