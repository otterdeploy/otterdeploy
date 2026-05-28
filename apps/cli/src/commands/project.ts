import { defineCommand } from "citty";
import { consola } from "consola";

import { createCliClient } from "../client";
import { resolveToken, resolveUrl } from "../config";

function requireClient(urlArg?: string) {
  const url = resolveUrl(urlArg);
  const token = resolveToken();
  if (!url || !token) {
    consola.error("Not logged in. Run `otterdeploy login <url>`.");
    process.exit(1);
  }
  return createCliClient({ url, token });
}

const listCommand = defineCommand({
  meta: { name: "list", description: "List projects in the active organization" },
  args: {
    url: { type: "string", description: "Override control plane URL" },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    const client = requireClient(args.url);
    const projects = await client.project.list();

    if (args.json) {
      process.stdout.write(`${JSON.stringify(projects, null, 2)}\n`);
      return;
    }

    if (projects.length === 0) {
      consola.info("No projects yet. Create one with `otterdeploy project create --name <name> --slug <slug>`.");
      return;
    }

    for (const p of projects) {
      consola.log(`${p.slug.padEnd(24)} ${p.name}  (${p.databaseCount} db${p.databaseCount === 1 ? "" : "s"})`);
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
    const client = requireClient(args.url);
    const project = await client.project.create({ name: args.name, slug: args.slug });

    if (args.json) {
      process.stdout.write(`${JSON.stringify(project, null, 2)}\n`);
      return;
    }

    consola.success(`Created ${project.slug} (${project.id})`);
  },
});

export const projectCommand = defineCommand({
  meta: { name: "project", description: "Manage projects" },
  subCommands: {
    list: listCommand,
    create: createCommand,
  },
});
