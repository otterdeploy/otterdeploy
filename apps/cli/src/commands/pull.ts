import { defineCommand } from "citty";
import { consola } from "consola";

import { ensureAuthenticated } from "../auth-flow";
import { createCliClient } from "../client";
import { configExists, loadConfig, writeConfig } from "../config-file";

export const pullCommand = defineCommand({
  meta: {
    name: "pull",
    description: "Overwrite the local config with the server's manifest",
  },
  args: {
    config: { type: "string", description: "Path to config file" },
    slug: {
      type: "string",
      description: "Project slug (defaults to the slug in the local file)",
    },
    url: { type: "string", description: "Override control plane URL" },
  },
  async run({ args }) {
    const { url, token } = await ensureAuthenticated(args.url);
    const client = createCliClient({ url, token });

    const slug =
      args.slug ?? (configExists(args.config) ? (await loadConfig(args.config)).project : null);
    if (!slug) {
      consola.error("No --slug provided and no local config to read it from.");
      process.exit(1);
    }

    const project = await client.project.getBySlug({ slug });
    const { manifest } = await client.project.manifest.get({ id: project.id });
    if (!manifest) {
      consola.error("Server has no manifest saved yet for this project.");
      process.exit(1);
    }

    const path = writeConfig(manifest, args.config);
    consola.success(`Wrote ${path}`);
  },
});
