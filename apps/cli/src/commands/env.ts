import { defineCommand } from "citty";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ensureAuthenticated } from "../auth-flow";
import { createCliClient } from "../client";
import { loadConfig } from "../config-file";
import { parseDotenv, parsePairs } from "../lib/dotenv";
import { cmd } from "../lib/name";
import { resolveProject } from "../lib/resolve";
import { suggestions } from "../lib/suggest";
import { abort, dim, interactive, note, ok, out, section, table } from "../lib/ui";

interface EnvVar {
  key: string;
  value: string;
  isSecret?: boolean;
}

/**
 * Print a variable set.
 *
 * Piped output stays raw `KEY=value`, because `env list --service web > .env` is
 * a real workflow and decorating it would corrupt the file. A terminal gets an
 * aligned table with secrets flagged — same data, formatted for the reader that
 * is actually there. This is the one place output shape depends on the TTY.
 */
function printVars(vars: EnvVar[], subject: string): void {
  if (vars.length === 0) {
    note(`No env vars on ${subject}.`);
    return;
  }
  if (!interactive()) {
    for (const { key, value } of vars) out(`${key}=${value}`);
    return;
  }
  section(`Env ${dim(subject)}`);
  table(
    [{ header: "key" }, { header: "value" }, { header: "" }],
    vars.map((v) => [v.key, v.value, v.isSecret ? dim("secret") : ""]),
  );
}

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
    abort("No service named.", "pass `--service <name>`", "or `--shared` for project-level vars");
  }
  const resources = await client.project.resource.list({ projectId: project.id });
  const svc = resources.find((r) => r.name === args.service);
  if (!svc) {
    abort(
      `No service \`${args.service}\` in project ${slug}.`,
      ...suggestions(
        args.service,
        resources.filter((r) => r.type === "service").map((r) => r.name),
      ).map((s) => `did you mean \`${s}\`?`),
    );
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
    const create = cmd("environments create <name>");
    abort(`Project ${ctx.projectSlug} has no environment.`, `run \`${create}\` first`);
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
    abort("`--shared` is project-level — drop it, or drop `--service`.");
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
      const { client, projectId, environmentId, projectSlug } = await requireSharedEnv(args);
      const vars = await client.project.envVar.list({ projectId, environmentId });
      if (args.json) {
        process.stdout.write(`${JSON.stringify(vars, null, 2)}\n`);
        return;
      }
      printVars(vars, `${projectSlug} (shared)`);
      return;
    }
    const { client, projectId, resourceId } = await requireService(args);
    const env = await client.service.env.list({ projectId, resourceId });
    if (args.json) {
      process.stdout.write(`${JSON.stringify(env, null, 2)}\n`);
      return;
    }
    printVars(env, String(args.service));
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
      abort("No KEY=VAL pairs given.", `e.g. \`${cmd("env set --service web LOG_LEVEL=debug")}\``);
    }
    if (args.shared) {
      const { client, projectId, environmentId, projectSlug } = await requireSharedEnv(args);
      for (const { key, value } of pairs) {
        await client.project.envVar.upsert({ projectId, environmentId, key, value });
      }
      ok(`Set ${pairs.length} shared var(s) on ${projectSlug}.`);
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
    ok(`Set ${pairs.length} var(s) on ${args.service}.`);
    // Setting a var restarts the service — say so rather than letting the
    // rolling update look like an unrelated event.
    note(dim("The service is rolling to pick up the change."));
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
      abort("No keys given.", `for example \`${cmd("env unset --service web OLD_VAR")}\``);
    }
    if (args.shared) {
      const { client, projectId, environmentId, projectSlug } = await requireSharedEnv(args);
      for (const key of keys) {
        await client.project.envVar.delete({ projectId, environmentId, key });
      }
      ok(`Unset ${keys.length} shared key(s) on ${projectSlug}.`);
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
    ok(`Unset ${keys.length} key(s) on ${args.service}.`);
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
      abort(`No file at ${path}.`);
    }
    const parsed = parseDotenv(readFileSync(path, "utf8"));
    // Without --merge this replaces the whole set, which silently drops any var
    // that isn't in the file. Naming that up front is the honest thing to do.
    if (!args.merge) note(dim(`Replacing all vars (pass --merge to keep existing ones).`));

    if (args.shared) {
      const { client, projectId, environmentId, projectSlug } = await requireSharedEnv(args);
      let vars: EnvVar[] = parsed;
      if (args.merge) {
        // bulkReplace is wholesale, so merge client-side — and carry the
        // existing isSecret flags or the replace would reset them.
        const existing = await client.project.envVar.list({ projectId, environmentId });
        const map = new Map<string, EnvVar>();
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
      ok(`Imported ${parsed.length} shared var(s) into ${projectSlug}.`);
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
    ok(`Imported ${parsed.length} var(s) from ${args.file}.`);
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
