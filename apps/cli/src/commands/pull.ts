import { defineCommand } from "citty";
import { consola } from "consola";

import { createCliClient } from "../client";
import { resolveToken, resolveUrl } from "../config";
import { loadManifestFile, manifestExists, writeManifestFile } from "../manifest-file";

export const pullCommand = defineCommand({
  meta: {
    name: "pull",
    description: "Overwrite the local otterstack.json with the server's manifest",
  },
  args: {
    slug: {
      type: "string",
      description: "Project slug (defaults to the slug in the local file)",
    },
    url: { type: "string", description: "Override control plane URL" },
  },
  async run({ args }) {
    const url = resolveUrl(args.url);
    const token = resolveToken();
    if (!url || !token) {
      consola.error("Not logged in. Run `otterdeploy login <url>`.");
      process.exit(1);
    }
    const client = createCliClient({ url, token });

    const slug = args.slug ?? (manifestExists() ? loadManifestFile().project : null);
    if (!slug) {
      consola.error("No --slug provided and no local otterstack.json to read it from.");
      process.exit(1);
    }

    const project = await client.project.getBySlug({ slug });
    const { manifest } = await client.project.manifest.get({ id: project.id });
    if (!manifest) {
      consola.error("Server has no manifest saved yet for this project.");
      process.exit(1);
    }

    const path = writeManifestFile(manifest);
    consola.success(`Wrote ${path}`);
  },
});
