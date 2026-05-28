import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { defineCommand } from "citty";
import { consola } from "consola";

import { ensureAuthenticated } from "../auth-flow";
import { createCliClient } from "../client";
import { loadConfig } from "../config-file";

async function requireService(args: {
  service?: string;
  url?: string;
  slug?: string;
  config?: string;
}) {
  const { url, token } = await ensureAuthenticated(args.url);
  const client = createCliClient({ url, token });
  const slug = args.slug ?? (await loadConfig(args.config)).project;
  const project = await client.project.getBySlug({ slug });
  if (!args.service) {
    consola.error("--service <name> is required.");
    process.exit(1);
  }
  const resources = await client.project.resource.list({ projectId: project.id });
  const svc = resources.find((r) => r.name === args.service);
  if (!svc) {
    consola.error(`Service ${args.service} not found in project ${slug}.`);
    process.exit(1);
  }
  return { client, projectId: project.id, resourceId: svc.resourceId, projectSlug: slug };
}

const listEnv = defineCommand({
  meta: { name: "list", description: "List env vars for a service" },
  args: {
    service: { type: "string", required: true, description: "Service name" },
    config: { type: "string", description: "Path to config file" },
    slug: { type: "string", description: "Project slug (defaults to config)" },
    url: { type: "string", description: "Override control plane URL" },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    const { client, projectId, resourceId } = await requireService(args);
    const env = await client.service.env.list({ projectId, resourceId });
    if (args.json) {
      process.stdout.write(`${JSON.stringify(env, null, 2)}\n`);
      return;
    }
    for (const { key, value } of env) consola.log(`${key}=${value}`);
  },
});

const setEnv = defineCommand({
  meta: { name: "set", description: "Set one or more env vars (KEY=VAL …)" },
  args: {
    service: { type: "string", required: true, description: "Service name" },
    config: { type: "string", description: "Path to config file" },
    slug: { type: "string", description: "Project slug (defaults to config)" },
    url: { type: "string", description: "Override control plane URL" },
    _: { type: "positional", required: false, description: "KEY=VAL pairs" },
  },
  async run({ args, rawArgs }) {
    const { client, projectId, resourceId } = await requireService(args);
    const pairs = parsePairs(rawArgs);
    if (pairs.length === 0) {
      consola.error(
        "Pass at least one KEY=VAL pair, e.g. `env set --service web DATABASE_URL=postgres://...`",
      );
      process.exit(1);
    }
    // Each service.env.set triggers a swarm redeploy of the service. For
    // N pairs that would be N sequential rolling updates (slow). Merge
    // with the existing env and ship one bulkSet — single redeploy.
    const existing = await client.service.env.list({ projectId, resourceId });
    const merged = new Map<string, string>();
    for (const e of existing) merged.set(e.key, e.value);
    for (const { key, value } of pairs) merged.set(key, value);
    const vars = [...merged.entries()].map(([key, value]) => ({ key, value }));
    await client.service.env.bulkSet({ projectId, resourceId, vars });
    consola.success(`Set ${pairs.length} var(s) on ${args.service}.`);
  },
});

const unsetEnv = defineCommand({
  meta: { name: "unset", description: "Remove env vars by key" },
  args: {
    service: { type: "string", required: true, description: "Service name" },
    config: { type: "string", description: "Path to config file" },
    slug: { type: "string", description: "Project slug (defaults to config)" },
    url: { type: "string", description: "Override control plane URL" },
    _: { type: "positional", required: false, description: "Keys to remove" },
  },
  async run({ args, rawArgs }) {
    const { client, projectId, resourceId } = await requireService(args);
    const keys = rawArgs.filter((a) => !a.startsWith("-") && !a.includes("="));
    if (keys.length === 0) {
      consola.error("Pass at least one key, e.g. `env unset --service web OLD_VAR`");
      process.exit(1);
    }
    // Same logic as `set` — one bulkSet/redeploy instead of N. Fetch
    // existing, drop the requested keys, send the remaining set back.
    const existing = await client.service.env.list({ projectId, resourceId });
    const toRemove = new Set(keys);
    const vars = existing
      .filter((e) => !toRemove.has(e.key))
      .map(({ key, value }) => ({ key, value }));
    await client.service.env.bulkSet({ projectId, resourceId, vars });
    consola.success(`Unset ${keys.length} key(s) on ${args.service}.`);
  },
});

const importEnv = defineCommand({
  meta: { name: "import", description: "Bulk-set env vars from a dotenv file" },
  args: {
    service: { type: "string", required: true, description: "Service name" },
    file: { type: "positional", required: true, description: "Path to .env file" },
    config: { type: "string", description: "Path to config file" },
    slug: { type: "string", description: "Project slug (defaults to config)" },
    url: { type: "string", description: "Override control plane URL" },
    merge: {
      type: "boolean",
      description: "Merge with existing (default replaces wholesale)",
    },
  },
  async run({ args }) {
    const { client, projectId, resourceId } = await requireService(args);
    const path = resolve(args.file);
    if (!existsSync(path)) {
      consola.error(`File not found: ${path}`);
      process.exit(1);
    }
    const parsed = parseDotenv(readFileSync(path, "utf8"));
    let vars = parsed;
    if (args.merge) {
      const existing = await client.service.env.list({ projectId, resourceId });
      const map = new Map<string, string>();
      for (const e of existing) map.set(e.key, e.value);
      for (const v of parsed) map.set(v.key, v.value);
      vars = [...map.entries()].map(([key, value]) => ({ key, value }));
    }
    await client.service.env.bulkSet({ projectId, resourceId, vars });
    consola.success(`Imported ${parsed.length} var(s) from ${args.file}.`);
  },
});

export const envCommand = defineCommand({
  meta: { name: "env", description: "Manage service env vars" },
  subCommands: {
    list: listEnv,
    set: setEnv,
    unset: unsetEnv,
    import: importEnv,
  },
});

function parsePairs(rawArgs: string[]): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = [];
  for (const arg of rawArgs) {
    if (arg.startsWith("-")) continue;
    const idx = arg.indexOf("=");
    if (idx === -1) continue;
    const key = arg.slice(0, idx);
    const value = arg.slice(idx + 1);
    if (key) out.push({ key, value });
  }
  return out;
}

function parseDotenv(body: string): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = [];
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out.push({ key, value });
  }
  return out;
}
