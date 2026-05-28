import { defineCommand } from "citty";
import { consola } from "consola";

import { createCliClient } from "../client";
import { resolveToken, resolveUrl } from "../config";
import { MANIFEST_FILENAME, manifestExists, writeManifestFile } from "../manifest-file";

export const initCommand = defineCommand({
  meta: {
    name: "init",
    description: `Create an ${MANIFEST_FILENAME} in the current directory and link it to a project`,
  },
  args: {
    name: { type: "string", description: "Project display name (prompted if omitted)" },
    slug: { type: "string", description: "Project slug" },
    url: { type: "string", description: "Override control plane URL" },
    force: { type: "boolean", description: `Overwrite an existing ${MANIFEST_FILENAME}` },
  },
  async run({ args }) {
    if (manifestExists() && !args.force) {
      consola.error(`${MANIFEST_FILENAME} already exists. Re-run with --force to overwrite.`);
      process.exit(1);
    }

    const url = resolveUrl(args.url);
    const token = resolveToken();
    if (!url || !token) {
      consola.error("Not logged in. Run `otterdeploy login <url>`.");
      process.exit(1);
    }
    const client = createCliClient({ url, token });

    const slug = args.slug ?? (await consola.prompt("Project slug:", { type: "text" }));
    const name = args.name ?? slug;

    // Link to existing or create. project.create returns CONFLICT if the
    // slug is taken in this org — fall back to fetching the existing row.
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

    const path = writeManifestFile({
      $schema: `${url.replace(/\/$/, "")}/otterstack.schema.json`,
      version: 1,
      project: project.slug,
      services: {},
      databases: {},
    } as never);

    consola.success(`Wrote ${path}`);
    consola.info("Next: edit the file, then run `otterdeploy deploy`.");
  },
});
