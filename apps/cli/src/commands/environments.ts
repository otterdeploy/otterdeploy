import { defineCommand } from "citty";
import { consola } from "consola";

import type { CliClient } from "../lib/resolve";

import { ensureAuthenticated } from "../auth-flow";
import { createCliClient } from "../client";
import { resolveProject } from "../lib/resolve";

type EnvRow = Awaited<ReturnType<CliClient["env"]["list"]>>[number];

interface EnvScope {
  client: CliClient;
  projectId: string | null;
  projectSlug: string | null;
}

// --project is an optional filter here (unlike env.ts where the project is
// implied), so only fall back to resolveProject when it's actually passed.
async function scopeFor(args: {
  project?: string;
  config?: string;
  url?: string;
}): Promise<EnvScope> {
  if (args.project) {
    const ctx = await resolveProject({ slug: args.project, config: args.config, url: args.url });
    return { client: ctx.client, projectId: ctx.projectId, projectSlug: ctx.projectSlug };
  }
  const { url, token } = await ensureAuthenticated(args.url);
  return { client: createCliClient({ url, token }), projectId: null, projectSlug: null };
}

async function resolveEnvironment(
  client: CliClient,
  nameOrId: string,
  projectId: string | null,
): Promise<EnvRow> {
  if (nameOrId.startsWith("env_")) return client.env.get({ id: nameOrId });
  const envs = await client.env.list(projectId ? { projectId } : {});
  const [match, ...rest] = envs.filter((e) => e.name === nameOrId || e.slug === nameOrId);
  if (!match) {
    consola.error(`Environment ${nameOrId} not found. Run \`otterdeploy environments list\`.`);
    process.exit(1);
  }
  if (rest.length > 0) {
    consola.error(`Multiple environments match ${nameOrId} — pass the env_… id instead:`);
    for (const m of [match, ...rest]) {
      consola.log(`  ${m.id}  (project: ${m.projectId ?? "standalone"})`);
    }
    process.exit(1);
  }
  return match;
}

function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

const listCommand = defineCommand({
  meta: { name: "list", description: "List environments" },
  args: {
    project: { type: "string", description: "Filter by project slug" },
    config: { type: "string", description: "Path to config file" },
    url: { type: "string", description: "Override control plane URL" },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    const { client, projectId } = await scopeFor(args);
    const envs = await client.env.list(projectId ? { projectId } : {});
    if (args.json) {
      process.stdout.write(`${JSON.stringify(envs, null, 2)}\n`);
      return;
    }
    if (envs.length === 0) {
      consola.info("No environments found. Create one with `otterdeploy environments create`.");
      return;
    }
    for (const e of envs) {
      const project = e.projectId ?? "standalone";
      const created = e.createdAt.toISOString().slice(0, 10);
      consola.log(`${e.name.padEnd(20)} ${e.id.padEnd(30)} ${project.padEnd(34)} ${created}`);
    }
  },
});

const createCommand = defineCommand({
  meta: { name: "create", description: "Create an environment" },
  args: {
    name: { type: "positional", required: true, description: "Environment name" },
    project: { type: "string", description: "Project slug to attach the environment to" },
    config: { type: "string", description: "Path to config file" },
    url: { type: "string", description: "Override control plane URL" },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    const { client, projectId, projectSlug } = await scopeFor(args);
    const slug = slugifyName(args.name);
    if (slug.length < 2) {
      consola.error(
        `Cannot derive a slug from "${args.name}" — use at least two alphanumeric characters.`,
      );
      process.exit(1);
    }
    const env = await client.env.create(
      projectId ? { name: args.name, slug, projectId } : { name: args.name, slug },
    );
    if (args.json) {
      process.stdout.write(`${JSON.stringify(env, null, 2)}\n`);
      return;
    }
    consola.success(
      `Created environment ${env.name} (${env.id})${projectSlug ? ` in ${projectSlug}` : ""}.`,
    );
    if (!env.projectId) {
      consola.info(
        "Standalone environment — it stays hidden from `environments list` until a project claims it.",
      );
    }
  },
});

const deleteCommand = defineCommand({
  meta: { name: "delete", description: "Delete an environment" },
  args: {
    environment: {
      type: "positional",
      required: true,
      description: "Environment name or env_… id",
    },
    project: { type: "string", description: "Project slug to scope the name lookup" },
    config: { type: "string", description: "Path to config file" },
    url: { type: "string", description: "Override control plane URL" },
    yes: { type: "boolean", description: "Skip confirmation" },
  },
  async run({ args }) {
    const { client, projectId } = await scopeFor(args);
    const env = await resolveEnvironment(client, args.environment, projectId);
    if (!args.yes) {
      const ok = await consola.prompt(
        `Delete environment ${env.name} (${env.id})? Its shared env vars go with it.`,
        { type: "confirm", initial: false },
      );
      if (!ok) {
        consola.info("Aborted.");
        return;
      }
    }
    await client.env.delete({ id: env.id });
    consola.success(`Deleted environment ${env.name} (${env.id}).`);
  },
});

export const environmentsCommand = defineCommand({
  meta: { name: "environments", description: "Manage project environments" },
  subCommands: {
    list: listCommand,
    create: createCommand,
    delete: deleteCommand,
  },
});
