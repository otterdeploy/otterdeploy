import { defineCommand } from "citty";
import { consola } from "consola";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ensureAuthenticated } from "../auth-flow";
import { createCliClient } from "../client";
import { loadConfig } from "../config-file";
import { parseDotenv, parsePairs } from "../lib/dotenv";
import { resolveProject } from "../lib/resolve";

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
    consola.error("--service <name> is required (or pass --shared for project-level vars).");
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

// Shared (project-level) vars are keyed (projectId, environmentId) server-side,
// so even "project vars" need the project's default environment resolved.
async function requireSharedEnv(args: { url?: string; slug?: string; config?: string }) {
  const ctx = await resolveProject(args);
  const project = await ctx.client.project.getBySlug({ slug: ctx.projectSlug });
  let environmentId: string | null = project.environmentId;
  if (!environmentId) {
    // The project has no bound default env — fall back to any environment
    // attached to it (env.list is already projectId-scoped).
    const envs = await ctx.client.env.list({ projectId: ctx.projectId });
    environmentId = envs[0]?.id ?? null;
  }
  if (!environmentId) {
    consola.error(
      `Project ${ctx.projectSlug} has no environment — create one with \`otterdeploy environments create\`.`,
    );
    process.exit(1);
  }
  return {
    client: ctx.client,
    projectId: ctx.projectId,
    environmentId,
    projectSlug: ctx.projectSlug,
  };
}

function rejectSharedWithService(args: { shared?: boolean; service?: string }): void {
  if (args.shared && args.service) {
    consola.error("--shared targets project-level vars — it cannot be combined with --service.");
    process.exit(1);
  }
}

const listEnv = defineCommand({
  meta: { name: "list", description: "List env vars for a service (or --shared project vars)" },
  args: {
    service: { type: "string", description: "Service name (omit with --shared)" },
    shared: { type: "boolean", description: "Target project-level shared vars" },
    config: { type: "string", description: "Path to config file" },
    slug: { type: "string", description: "Project slug (defaults to config)" },
    url: { type: "string", description: "Override control plane URL" },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    rejectSharedWithService(args);
    if (args.shared) {
      const { client, projectId, environmentId } = await requireSharedEnv(args);
      const vars = await client.project.envVar.list({ projectId, environmentId });
      if (args.json) {
        process.stdout.write(`${JSON.stringify(vars, null, 2)}\n`);
        return;
      }
      for (const { key, value } of vars) consola.log(`${key}=${value}`);
      return;
    }
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
    service: { type: "string", description: "Service name (omit with --shared)" },
    shared: { type: "boolean", description: "Target project-level shared vars" },
    config: { type: "string", description: "Path to config file" },
    slug: { type: "string", description: "Project slug (defaults to config)" },
    url: { type: "string", description: "Override control plane URL" },
    _: { type: "positional", required: false, description: "KEY=VAL pairs" },
  },
  async run({ args, rawArgs }) {
    rejectSharedWithService(args);
    const pairs = parsePairs(rawArgs);
    if (pairs.length === 0) {
      consola.error(
        "Pass at least one KEY=VAL pair, e.g. `env set --service web DATABASE_URL=postgres://...`",
      );
      process.exit(1);
    }
    if (args.shared) {
      const { client, projectId, environmentId, projectSlug } = await requireSharedEnv(args);
      for (const { key, value } of pairs) {
        await client.project.envVar.upsert({ projectId, environmentId, key, value });
      }
      consola.success(`Set ${pairs.length} shared var(s) on ${projectSlug}.`);
      return;
    }
    const { client, projectId, resourceId } = await requireService(args);
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
    service: { type: "string", description: "Service name (omit with --shared)" },
    shared: { type: "boolean", description: "Target project-level shared vars" },
    config: { type: "string", description: "Path to config file" },
    slug: { type: "string", description: "Project slug (defaults to config)" },
    url: { type: "string", description: "Override control plane URL" },
    _: { type: "positional", required: false, description: "Keys to remove" },
  },
  async run({ args, rawArgs }) {
    rejectSharedWithService(args);
    // Bare positionals are the keys — but skip the VALUE of a space-separated
    // string flag (e.g. the "web" in `--service web`), which is also bare.
    const valueFlags = new Set(["--service", "--config", "--slug", "--url"]);
    const keys = rawArgs.filter((a, i) => {
      if (a.startsWith("-") || a.includes("=")) return false;
      const prev = rawArgs[i - 1];
      return prev === undefined || !valueFlags.has(prev);
    });
    if (keys.length === 0) {
      consola.error("Pass at least one key, e.g. `env unset --service web OLD_VAR`");
      process.exit(1);
    }
    if (args.shared) {
      const { client, projectId, environmentId, projectSlug } = await requireSharedEnv(args);
      for (const key of keys) {
        await client.project.envVar.delete({ projectId, environmentId, key });
      }
      consola.success(`Unset ${keys.length} shared key(s) on ${projectSlug}.`);
      return;
    }
    const { client, projectId, resourceId } = await requireService(args);
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
    service: { type: "string", description: "Service name (omit with --shared)" },
    shared: { type: "boolean", description: "Target project-level shared vars" },
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
    rejectSharedWithService(args);
    const path = resolve(args.file);
    if (!existsSync(path)) {
      consola.error(`File not found: ${path}`);
      process.exit(1);
    }
    const parsed = parseDotenv(readFileSync(path, "utf8"));
    if (args.shared) {
      const { client, projectId, environmentId, projectSlug } = await requireSharedEnv(args);
      let vars: Array<{ key: string; value: string; isSecret?: boolean }> = parsed;
      if (args.merge) {
        // bulkReplace is wholesale, so merge client-side — and carry the
        // existing isSecret flags or the replace would reset them.
        const existing = await client.project.envVar.list({ projectId, environmentId });
        const map = new Map<string, { key: string; value: string; isSecret?: boolean }>();
        for (const e of existing) {
          map.set(e.key, { key: e.key, value: e.value, isSecret: e.isSecret });
        }
        for (const v of parsed) {
          const prev = map.get(v.key);
          map.set(v.key, prev ? { ...prev, value: v.value } : { key: v.key, value: v.value });
        }
        vars = [...map.values()];
      }
      await client.project.envVar.bulkReplace({ projectId, environmentId, vars });
      consola.success(`Imported ${parsed.length} shared var(s) into ${projectSlug}.`);
      return;
    }
    const { client, projectId, resourceId } = await requireService(args);
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
  meta: { name: "env", description: "Manage service and shared project env vars" },
  subCommands: {
    list: listEnv,
    set: setEnv,
    unset: unsetEnv,
    import: importEnv,
  },
});
