import { defineCommand } from "citty";
import { consola } from "consola";

import { ensureAuthenticated } from "../auth-flow";
import { createCliClient } from "../client";
import { configExists, loadConfig } from "../config-file";

export const logsCommand = defineCommand({
  meta: {
    name: "logs",
    description: "Tail logs from a service or database",
  },
  args: {
    resource: {
      type: "positional",
      required: false,
      description: "Resource name (service or database)",
    },
    config: { type: "string", description: "Path to config file" },
    slug: { type: "string", description: "Project slug (defaults to config)" },
    tail: { type: "string", description: "Replay this many lines first (default 100)" },
    url: { type: "string", description: "Override control plane URL" },
    json: { type: "boolean", description: "Output as one JSON event per line" },
  },
  async run({ args }) {
    if (!args.resource) {
      consola.error("Pass a resource name, e.g. `otterdeploy logs web`.");
      process.exit(1);
    }

    const { url, token } = await ensureAuthenticated(args.url);
    const client = createCliClient({ url, token });

    const slug =
      args.slug ?? (configExists(args.config) ? (await loadConfig(args.config)).project : null);
    if (!slug) {
      consola.error("No --slug provided and no local config to read it from.");
      process.exit(1);
    }

    const project = await client.project.getBySlug({ slug });
    const resources = await client.project.resource.list({ projectId: project.id });
    const target = resources.find((r) => r.name === args.resource);
    if (!target) {
      consola.error(`Resource ${args.resource} not found in project ${slug}.`);
      process.exit(1);
    }

    const tail = args.tail ? Number.parseInt(args.tail, 10) : 100;
    const stream = await client.project.resource.logs.tail({
      projectId: project.id,
      resourceId: target.resourceId,
      tail: Number.isFinite(tail) ? tail : 100,
    });

    // Graceful SIGINT — leave the stream's `for await` early so the
    // server-side generator's finally block releases the docker bus.
    let stopping = false;
    process.on("SIGINT", () => {
      stopping = true;
    });

    try {
      for await (const event of stream) {
        if (stopping) break;
        if (args.json) {
          process.stdout.write(`${JSON.stringify(event)}\n`);
          continue;
        }
        const tag = event.stream === "stderr" ? "[err]" : event.stream === "system" ? "[sys]" : "";
        const ts = event.ts ? `${event.ts} ` : "";
        process.stdout.write(`${ts}${tag}${tag ? " " : ""}${event.line}\n`);
      }
    } catch (error) {
      if (!stopping) throw error;
    }
  },
});
