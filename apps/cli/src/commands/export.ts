import { writeFileSync } from "node:fs";

import { defineCommand } from "citty";
import { consola } from "consola";

import { createCliClient } from "../client";
import { resolveToken, resolveUrl } from "../config";
import { loadManifestFile, manifestExists } from "../manifest-file";

export const exportCommand = defineCommand({
  meta: {
    name: "export",
    description: "Render the project as a deployable docker-compose stack file",
  },
  args: {
    slug: { type: "string", description: "Project slug (defaults to manifest)" },
    out: { type: "string", description: "Write to this path instead of stdout" },
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
    const { yaml } = await client.project.manifest.export({ projectId: project.id });

    if (args.out) {
      writeFileSync(args.out, yaml);
      consola.success(`Wrote ${args.out}`);
      return;
    }
    process.stdout.write(yaml);
  },
});
