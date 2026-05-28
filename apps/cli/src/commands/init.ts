import { defineCommand } from "citty";
import { consola } from "consola";

import { ensureAuthenticated } from "../auth-flow";
import { createCliClient } from "../client";
import {
  DEFAULT_CONFIG_FILENAME,
  configExists,
  configPath,
  writeConfigTemplate,
} from "../config-file";

export const initCommand = defineCommand({
  meta: {
    name: "init",
    description: `Scaffold an ${DEFAULT_CONFIG_FILENAME} template`,
  },
  args: {
    name: { type: "string", description: "Project display name (prompted if omitted)" },
    slug: { type: "string", description: "Project slug" },
    url: { type: "string", description: "Override control plane URL" },
    config: {
      type: "string",
      description: `Path to config file (default: ${DEFAULT_CONFIG_FILENAME})`,
    },
    yes: { type: "boolean", description: "Skip confirmation prompts" },
  },
  async run({ args }) {
    const path = configPath(args.config);
    if (configExists(args.config) && !args.yes) {
      const ok = await consola.prompt(`${path} already exists. Overwrite?`, {
        type: "confirm",
        initial: false,
      });
      if (!ok) {
        consola.info("Aborted.");
        process.exit(1);
      }
    }

    const { url, token } = await ensureAuthenticated(args.url);
    const client = createCliClient({ url, token });

    const slug = args.slug ?? (await consola.prompt("Project slug:", { type: "text" }));
    const name = args.name ?? slug;

    let project: { id: string; slug: string };
    try {
      project = await client.project.create({ name, slug });
      consola.success(`Created project ${slug}`);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "CONFLICT") throw error;
      project = await client.project.getBySlug({ slug });
      consola.info(`Linked to existing project ${slug}`);
    }

    writeConfigTemplate({
      path,
      schemaUrl: `${url.replace(/\/$/, "")}/otterstack.schema.json`,
      projectSlug: project.slug,
    });

    consola.success(`Wrote ${path}`);
    consola.info("Next: edit the file, then run `otterdeploy sync`.");
  },
});
