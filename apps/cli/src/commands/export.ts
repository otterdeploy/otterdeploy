import { defineCommand } from "citty";
import { writeFileSync } from "node:fs";

import { ensureAuthenticated } from "../auth-flow";
import { createCliClient } from "../client";
import { configExists, loadConfig } from "../config-file";
import { cmd } from "../lib/name";
import { abort, detail, dim, ok } from "../lib/ui";

export const exportCommand = defineCommand({
  meta: {
    name: "export",
    description: "Render the project as a deployable docker-compose stack file",
  },
  args: {
    config: { type: "string", description: "Path to config file" },
    slug: { type: "string", description: "Project slug (defaults to config)" },
    out: { type: "string", description: "Write to this path instead of stdout" },
    url: { type: "string", description: "Override control plane URL" },
  },
  async run({ args }) {
    const { url, token } = await ensureAuthenticated(args.url);
    const client = createCliClient({ url, token });

    const slug =
      args.slug ?? (configExists(args.config) ? (await loadConfig(args.config)).project : null);
    if (!slug) {
      abort(
        "No project to export.",
        "pass `--slug <slug>`",
        `or run \`${cmd("init")}\` in this directory`,
      );
    }

    const project = await client.project.getBySlug({ slug });
    const { yaml } = await client.project.manifest.export({ projectId: project.id });

    if (args.out) {
      writeFileSync(args.out, yaml);
      ok("Wrote the compose stack.");
      detail([["file", dim(args.out)]]);
      return;
    }
    process.stdout.write(yaml);
  },
});
