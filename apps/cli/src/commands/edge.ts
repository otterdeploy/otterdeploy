import { defineCommand } from "citty";
import { consola } from "consola";

import type { CliClient } from "../lib/resolve";

import { ensureAuthenticated } from "../auth-flow";
import { createCliClient } from "../client";
import { configExists } from "../config-file";
import { resolveProject } from "../lib/resolve";

interface EdgeScope {
  client: CliClient;
  projectId: string | null;
}

// Project scope is optional by design: the server tails the given project's
// domains when a projectId is sent, otherwise every domain in the org.
async function edgeScope(args: {
  slug?: string;
  config?: string;
  url?: string;
}): Promise<EdgeScope> {
  if (args.slug || configExists(args.config)) {
    const ctx = await resolveProject(args);
    return { client: ctx.client, projectId: ctx.projectId };
  }
  const { url, token } = await ensureAuthenticated(args.url);
  return { client: createCliClient({ url, token }), projectId: null };
}

function scopeLabel(projectId: string | null, host?: string): string {
  return host ?? (projectId ? "project domains" : "all org domains");
}

const tailCommand = defineCommand({
  meta: { name: "tail", description: "Live-tail edge (Caddy) access logs" },
  args: {
    host: { type: "string", description: "Restrict to a single host" },
    config: { type: "string", description: "Path to config file" },
    slug: { type: "string", description: "Project slug (defaults to config; omit for org-wide)" },
    url: { type: "string", description: "Override control plane URL" },
    json: { type: "boolean", description: "Output as one JSON event per line" },
  },
  async run({ args }) {
    const { client, projectId } = await edgeScope(args);
    const stream = await client.edgeLogs.tail({
      projectId: projectId ?? undefined,
      host: args.host,
    });
    if (!args.json) {
      consola.info(
        `Tailing edge access logs (${scopeLabel(projectId, args.host)}) — Ctrl-C to stop.`,
      );
    }

    // Graceful SIGINT — leave the stream's `for await` early so the
    // server-side generator's finally block unsubscribes from the ring.
    // Exit on Ctrl-C: installing a SIGINT listener suppresses the default
    // terminate, and a blocked `for await` on an idle stream can't observe a
    // mere flag — so terminate here. Dropping the socket runs the server
    // generator's finally (ring unsubscribe).
    let stopping = false;
    process.on("SIGINT", () => {
      stopping = true;
      process.exit(0);
    });

    try {
      for await (const line of stream) {
        if (stopping) break;
        if (args.json) {
          process.stdout.write(`${JSON.stringify(line)}\n`);
          continue;
        }
        process.stdout.write(
          `${line.ts}  ${line.status}  ${line.method.padEnd(7)} ${line.host}${line.path}  ${Math.round(line.latencyMs)}ms\n`,
        );
      }
    } catch (error) {
      if (!stopping) throw error;
    }
  },
});

const eventsCommand = defineCommand({
  meta: { name: "events", description: "Live-tail edge operational events (certs, upstreams)" },
  args: {
    host: { type: "string", description: "Restrict to a single host" },
    config: { type: "string", description: "Path to config file" },
    slug: { type: "string", description: "Project slug (defaults to config; omit for org-wide)" },
    url: { type: "string", description: "Override control plane URL" },
    json: { type: "boolean", description: "Output as one JSON event per line" },
  },
  async run({ args }) {
    const { client, projectId } = await edgeScope(args);
    const stream = await client.edgeLogs.events.tail({
      projectId: projectId ?? undefined,
      host: args.host,
    });
    if (!args.json) {
      consola.info(`Tailing edge events (${scopeLabel(projectId, args.host)}) — Ctrl-C to stop.`);
    }

    // Exit on Ctrl-C: installing a SIGINT listener suppresses the default
    // terminate, and a blocked `for await` on an idle stream can't observe a
    // mere flag — so terminate here. Dropping the socket runs the server
    // generator's finally (ring unsubscribe).
    let stopping = false;
    process.on("SIGINT", () => {
      stopping = true;
      process.exit(0);
    });

    try {
      for await (const event of stream) {
        if (stopping) break;
        if (args.json) {
          process.stdout.write(`${JSON.stringify(event)}\n`);
          continue;
        }
        const suffix = event.error ? ` — ${event.error}` : "";
        process.stdout.write(
          `${event.ts}  ${event.level.padEnd(5)}  ${event.category.padEnd(8)} ${event.host ?? "-"}  ${event.msg}${suffix}\n`,
        );
      }
    } catch (error) {
      if (!stopping) throw error;
    }
  },
});

export const edgeCommand = defineCommand({
  meta: { name: "edge", description: "Edge (Caddy) access logs and operational events" },
  subCommands: {
    tail: tailCommand,
    events: eventsCommand,
  },
});
