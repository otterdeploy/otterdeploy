import { defineCommand } from "citty";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { createCliClient } from "../client";
import { loadConfig, resolveToken, resolveUrl } from "../config";
import {
  configExists,
  JSON_CONFIG_FILENAME,
  TS_CONFIG_FILENAME,
  writeConfigTemplate,
} from "../config-file";
import { cmd } from "../lib/name";
import { abort, ask, confirm, detail, dim, hint, note, ok, warn } from "../lib/ui";

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
      abort("Not logged in.", `run \`${cmd("login <url>")}\` first`);
    }

    const targetPath = args.config
      ? resolve(process.cwd(), args.config)
      : resolve(process.cwd(), args.format === "ts" ? TS_CONFIG_FILENAME : JSON_CONFIG_FILENAME);

    const alreadyExists = args.config ? existsSync(targetPath) : configExists();
    if (alreadyExists && !args.yes) {
      warn(`A config already exists at ${targetPath}.`);
      if (!(await confirm("Overwrite it?"))) {
        abort("Aborted. The existing config was kept.");
      }
    }

    const client = createCliClient({ url, token });

    const slug = args.slug ?? (await ask("Project slug"));
    if (!slug) abort("A project slug is required.", "pass `--slug <slug>`");
    const name = args.name ?? slug;

    let project: { id: string; slug: string };
    try {
      project = await client.project.create({ name, slug });
      ok(`Created project ${slug}.`);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "CONFLICT") throw error;
      project = await client.project.getBySlug({ slug });
      // Linking to an existing project is the expected path on a second
      // machine, so it reads as information rather than as a fallback.
      note(`Linked to existing project ${slug}.`);
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

    ok("Wrote the config.");
    detail([
      ["file", dim(targetPath)],
      ["project", project.slug],
    ]);
    hint("edit the file to declare services and databases");
    hint(`then run \`${cmd("deploy")}\``);
  },
});
