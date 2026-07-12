import { defineCommand } from "citty";
import { consola } from "consola";

import { ensureAuthenticated } from "../auth-flow";
import { createCliClient } from "../client";

// "90d" | "12h" | "30m" → seconds; "never" → null (non-expiring key).
function parseExpires(raw: string): number | null {
  if (raw === "never") return null;
  const match = /^(\d+)([dhm])$/.exec(raw);
  const amount = Number(match?.[1]);
  if (!match || amount <= 0) {
    consola.error(`Invalid --expires "${raw}". Use <N>d, <N>h, <N>m (e.g. 90d) or "never".`);
    process.exit(1);
  }
  const unit = match[2] === "d" ? 86_400 : match[2] === "h" ? 3_600 : 60;
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
        consola.error("--project requires a project slug.");
        process.exit(1);
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

    consola.box(
      [
        "API key created — copy it now, it won't be shown again:",
        "",
        `  ${created.key}`,
        "",
        "Use it in CI or scripts:",
        "",
        `  export OTTERDEPLOY_TOKEN=${created.key}`,
      ].join("\n"),
    );
    if (created.expiresAt) consola.info(`Expires ${created.expiresAt.toISOString()}.`);
    else consola.info("This key never expires.");
  },
});

export const tokensCommand = defineCommand({
  meta: { name: "tokens", description: "Manage API keys" },
  subCommands: {
    create: createToken,
  },
});
