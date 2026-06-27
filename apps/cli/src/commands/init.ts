import { defineCommand } from "citty";
import { consola } from "consola";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { createCliClient } from "../client";
import { loadConfig, resolveToken, resolveUrl } from "../config";
import { configExists, writeConfigTemplate } from "../config-file";

const TS_FILENAME = "otterdeploy.config.ts";
const JSON_FILENAME = "otterdeploy.config.json";

export const initCommand = defineCommand({
  meta: {
    name: "init",
    description: "Scaffold an otterdeploy config and link or create the project",
  },
  args: {
    name: { type: "string", description: "Project display name (prompted if omitted)" },
    slug: { type: "string", description: "Project slug" },
    config: { type: "string", description: "Path to config file (overrides --format)" },
    format: {
      type: "string",
      description: "Config format when no --config given: json (default) | ts",
    },
    yes: { type: "boolean", description: "Skip confirmation prompts" },
  },
  async run({ args }) {
    const url = resolveUrl();
    const token = resolveToken();
    if (!url || !token) {
      consola.error("Not logged in. Run `otterdeploy login <url>` first.");
      process.exit(1);
    }

    const targetPath = args.config
      ? resolve(process.cwd(), args.config)
      : resolve(process.cwd(), args.format === "ts" ? TS_FILENAME : JSON_FILENAME);

    const alreadyExists = args.config ? existsSync(targetPath) : configExists();
    if (alreadyExists && !args.yes) {
      const ok = await consola.prompt(
        `A config already exists${args.config ? ` at ${targetPath}` : ""}. Overwrite ${targetPath}?`,
        { type: "confirm", initial: false },
      );
      if (!ok) {
        consola.info("Aborted.");
        process.exit(1);
      }
    }

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

    // The schema is served as a static asset on the WEB origin, not the
    // API. webUrl is captured during login; fall back to the API URL only
    // if a pre-existing config predates that change.
    const schemaHost = loadConfig().webUrl ?? url;
    writeConfigTemplate({
      path: targetPath,
      schemaUrl: `${schemaHost.replace(/\/$/, "")}/otterdeploy.schema.json`,
      projectSlug: project.slug,
    });

    consola.success(`Wrote ${targetPath}`);
    consola.info("Next: edit the file, then run `otterdeploy sync` or `otterdeploy deploy`.");
  },
});
