import { defineCommand } from "citty";
import { consola } from "consola";

import { ensureAuthenticated } from "../auth-flow";
import { createCliClient } from "../client";

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
      consola.info(
        "No projects yet. Create one with `otterdeploy project create --name <name> --slug <slug>`.",
      );
      return;
    }

    for (const p of projects) {
      consola.log(
        `${p.slug.padEnd(24)} ${p.name}  (${p.databaseCount} db${p.databaseCount === 1 ? "" : "s"})`,
      );
    }
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

    consola.success(`Created ${project.slug} (${project.id})`);
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
        consola.error(
          "Refusing to delete without confirmation in a non-interactive shell. Pass --force.",
        );
        process.exit(1);
      }
      consola.warn(
        `This permanently deletes ${project.slug} (${project.id}) and every service, database, and route in it.`,
      );
      const confirmed = await consola.prompt(`Delete project ${project.slug}?`, {
        type: "confirm",
        initial: false,
      });
      if (confirmed !== true) {
        consola.error("Aborted.");
        process.exit(1);
      }
      const typed = await consola.prompt("Type the project slug to confirm:", { type: "text" });
      if (typed !== args.slug) {
        consola.error("Slug mismatch — nothing deleted.");
        process.exit(1);
      }
    }

    await client.project.delete({ id: project.id });
    consola.success(`Deleted project ${args.slug}.`);
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
