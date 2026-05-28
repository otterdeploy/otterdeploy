import { defineCommand } from "citty";
import { consola } from "consola";

import { createCliClient } from "../client";
import { resolveToken, resolveUrl } from "../config";
import { loadManifestFile, manifestExists } from "../manifest-file";

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
    slug: { type: "string", description: "Project slug (defaults to manifest)" },
    tail: { type: "string", description: "Replay this many lines first (default 100)" },
    url: { type: "string", description: "Override control plane URL" },
    json: { type: "boolean", description: "Output as one JSON event per line" },
  },
  async run({ args }) {
    if (!args.resource) {
      consola.error("Pass a resource name, e.g. `otterdeploy logs web`.");
      process.exit(1);
    }

    const url = resolveUrl(args.url);
    const token = resolveToken();
    if (!url || !token) {
      consola.error("Not logged in. Run `otterdeploy login <url>`.");
      process.exit(1);
    }
    const client = createCliClient({ url, token });

    const slug =
      args.slug ?? (manifestExists() ? loadManifestFile().project : null);
    if (!slug) {
      consola.error("No --slug provided and no local otterstack.json to read it from.");
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
        const tag =
          event.stream === "stderr" ? "[err]" : event.stream === "system" ? "[sys]" : "";
        const ts = event.ts ? `${event.ts} ` : "";
        process.stdout.write(`${ts}${tag}${tag ? " " : ""}${event.line}\n`);
      }
    } catch (error) {
      if (!stopping) throw error;
    }
  },
});
