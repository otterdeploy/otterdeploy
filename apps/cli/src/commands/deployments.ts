import { defineCommand } from "citty";
import { consola } from "consola";

import { resolveResource } from "../lib/resolve";

const DEFAULT_LIMIT = 20;

function relativeTime(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export const deploymentsCommand = defineCommand({
  meta: {
    name: "deployments",
    description: "List deployment history for a service",
  },
  args: {
    service: { type: "positional", required: false, description: "Service name" },
    config: { type: "string", description: "Path to config file" },
    slug: { type: "string", description: "Project slug (defaults to config)" },
    url: { type: "string", description: "Override control plane URL" },
    limit: { type: "string", description: "Max deployments to show (default 20)" },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    const ctx = await resolveResource(args, args.service, "service");
    const rows = await ctx.client.project.resource.deployments.list({
      projectId: ctx.projectId,
      resourceId: ctx.resourceId,
    });
    const parsed = args.limit ? Number.parseInt(args.limit, 10) : DEFAULT_LIMIT;
    const shown = rows.slice(0, Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LIMIT);

    if (args.json) {
      process.stdout.write(`${JSON.stringify(shown, null, 2)}\n`);
      return;
    }
    if (shown.length === 0) {
      consola.info(`No deployments yet for ${ctx.resourceName}.`);
      return;
    }

    // Fixed pads sized to the longest enum values: status "superseded"
    // (10), reason "image-change" (12), relative times ≤ "999d ago" (9).
    consola.log(
      `  ${"ID".padEnd(8)}  ${"STATUS".padEnd(10)}  ${"REASON".padEnd(12)}  ${"SHA".padEnd(7)}  ${"CREATED".padEnd(9)}  ${"COMPLETED".padEnd(9)}  ERROR`,
    );
    for (const d of shown) {
      const cols = [
        d.id.slice(-8).padEnd(8),
        d.status.padEnd(10),
        d.reason.padEnd(12),
        (d.gitSha ? d.gitSha.slice(0, 7) : d.sourceSha ? d.sourceSha.slice(0, 7) : "—").padEnd(7),
        relativeTime(d.createdAt).padEnd(9),
        (d.completedAt ? relativeTime(d.completedAt) : "—").padEnd(9),
        d.errorMessage ? truncate(d.errorMessage, 60) : "",
      ];
      consola.log(`  ${cols.join("  ")}`.trimEnd());
    }
  },
});
