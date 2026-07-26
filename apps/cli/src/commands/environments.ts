import { defineCommand } from "citty";

import type { CliClient } from "../lib/resolve";

import { ensureAuthenticated } from "../auth-flow";
import { createCliClient } from "../client";
import { relativeTime } from "../lib/format";
import { cmd } from "../lib/name";
import { resolveProject } from "../lib/resolve";
import { suggestions } from "../lib/suggest";
import {
  abort,
  confirm,
  detail,
  dim,
  err,
  hint,
  note,
  ok,
  paint,
  row,
  section,
  table,
} from "../lib/ui";

type EnvRow = Awaited<ReturnType<CliClient["env"]["list"]>>[number];

/** Shortest slug the server will accept. */
const MIN_SLUG_LENGTH = 2;
const MAX_SLUG_LENGTH = 48;

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
    abort(
      `No environment \`${nameOrId}\`.`,
      ...suggestions(
        nameOrId,
        envs.map((e) => e.name),
      ).map((s) => `did you mean \`${s}\`?`),
      `run \`${cmd("environments list")}\` to see them`,
    );
  }
  if (rest.length > 0) {
    // Print the candidates first — `abort` exits, so a list after it would
    // never be seen (this was the bug the old code shipped).
    err();
    for (const m of [match, ...rest]) {
      row([paint("id", m.id), dim(`project: ${m.projectId ?? "standalone"}`)]);
    }
    err();
    abort(
      `\`${nameOrId}\` matches ${rest.length + 1} environments.`,
      "pass the env_… id instead",
    );
  }
  return match;
}

function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH);
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
      note("No environments found.");
      hint(`run \`${cmd("environments create <name>")}\``);
      return;
    }

    section("Environments");
    table(
      [{ header: "name" }, { header: "id" }, { header: "project" }, { header: "created" }],
      envs.map((e) => [
        e.name,
        paint("id", e.id),
        // "standalone" is a real state, not a missing value — dim, not absent.
        e.projectId ?? dim("standalone"),
        dim(relativeTime(e.createdAt.toISOString())),
      ]),
    );
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
    if (slug.length < MIN_SLUG_LENGTH) {
      // Must exit: continuing would POST an unusable slug and fail server-side
      // with a much worse message.
      abort(
        `Cannot derive a slug from "${args.name}".`,
        "use at least two alphanumeric characters",
      );
    }
    const env = await client.env.create(
      projectId ? { name: args.name, slug, projectId } : { name: args.name, slug },
    );
    if (args.json) {
      process.stdout.write(`${JSON.stringify(env, null, 2)}\n`);
      return;
    }
    ok(`Created environment ${env.name}.`);
    detail([
      ["id", paint("id", env.id)],
      ["slug", env.slug],
      ["project", projectSlug ?? dim("standalone")],
    ]);
    if (!env.projectId) {
      note("Standalone — hidden from `environments list` until a project claims it.");
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
      // Name the collateral damage in the prompt — shared env vars go with it.
      const proceed = await confirm(
        `Delete environment ${env.name} and its shared env vars?`,
      );
      if (!proceed) abort("Aborted — nothing was deleted.");
    }
    await client.env.delete({ id: env.id });
    ok(`Deleted environment ${env.name}.`);
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
