import { defineCommand } from "citty";

import { ensureAuthenticated } from "../auth-flow";
import { createCliClient } from "../client";
import { cmd } from "../lib/name";
import {
  abort,
  ask,
  confirm,
  detail,
  dim,
  hint,
  note,
  ok,
  out,
  paint,
  section,
  table,
  warn,
} from "../lib/ui";

const listCommand = defineCommand({
  meta: { name: "list", description: "List projects in the active organization" },
  args: {
    url: { type: "string", description: "Override control plane URL" },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    const { url, token } = await ensureAuthenticated(args.url);
    const client = createCliClient({ url, token });
    const projects = await client.project.list();

    if (args.json) {
      process.stdout.write(`${JSON.stringify(projects, null, 2)}\n`);
      return;
    }

    if (projects.length === 0) {
      note("No projects yet.");
      hint(`run \`${cmd("project create --name <name> --slug <slug>")}\``);
      hint(`or \`${cmd("init")}\` to scaffold one from this directory`);
      return;
    }

    section("Projects");
    table(
      [{ header: "slug" }, { header: "name" }, { header: "databases", align: "right" }],
      projects.map((p) => [p.slug, p.name, dim(String(p.databaseCount))]),
    );
  },
});

const createCommand = defineCommand({
  meta: { name: "create", description: "Create a new project" },
  args: {
    name: { type: "string", required: true, description: "Display name" },
    slug: { type: "string", required: true, description: "URL-safe slug" },
    url: { type: "string", description: "Override control plane URL" },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    const { url, token } = await ensureAuthenticated(args.url);
    const client = createCliClient({ url, token });
    const project = await client.project.create({ name: args.name, slug: args.slug });

    if (args.json) {
      process.stdout.write(`${JSON.stringify(project, null, 2)}\n`);
      return;
    }

    ok(`Created project ${project.slug}.`);
    detail([
      ["name", project.name],
      ["id", paint("id", project.id)],
    ]);
    hint(`run \`${cmd("init")}\` here to link a config to it`);
  },
});

const deleteCommand = defineCommand({
  meta: {
    name: "delete",
    description: "Permanently delete a project and all its resources",
  },
  args: {
    slug: { type: "positional", required: true, description: "Project slug" },
    url: { type: "string", description: "Override control plane URL" },
    force: {
      type: "boolean",
      description: "Skip confirmation prompts (required in non-interactive shells)",
    },
  },
  async run({ args }) {
    const { url, token } = await ensureAuthenticated(args.url);
    const client = createCliClient({ url, token });
    const project = await client.project.getBySlug({ slug: args.slug });

    if (!args.force) {
      if (!process.stdin.isTTY) {
        abort(
          "Refusing to delete without confirmation in a non-interactive shell.",
          "pass `--force` if you are certain",
        );
      }
      // Two gates for the most destructive command in the CLI: a yes/no, then
      // typing the slug. State exactly what goes with it before either.
      section("Delete project");
      detail([
        ["project", paint("danger", project.slug)],
        ["id", dim(project.id)],
      ]);
      out();
      warn("This permanently deletes every service, database, and route in it.");

      if (!(await confirm(`Delete project ${project.slug}?`))) {
        abort("Aborted — nothing was deleted.");
      }
      const typed = await ask("Type the project slug to confirm");
      if (typed !== args.slug) {
        abort("Slug did not match — nothing was deleted.");
      }
    }

    await client.project.delete({ id: project.id });
    ok(`Deleted project ${args.slug}.`);
  },
});

export const projectCommand = defineCommand({
  meta: { name: "project", description: "Manage projects" },
  subCommands: {
    list: listCommand,
    create: createCommand,
    delete: deleteCommand,
  },
});
