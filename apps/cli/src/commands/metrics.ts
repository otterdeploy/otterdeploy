import { defineCommand } from "citty";
import { consola } from "consola";

import { resolveResource } from "../lib/resolve";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "-";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = Math.abs(bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rendered = unit === 0 ? String(Math.round(value)) : value.toFixed(1);
  return `${bytes < 0 ? "-" : ""}${rendered} ${units[unit] ?? "B"}`;
}

// Callers guarantee a non-empty array (guarded on `points.at(-1)`).
function stats(values: number[]): { min: number; avg: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
    sum += value;
  }
  return { min, avg: sum / values.length, max };
}

export const metricsCommand = defineCommand({
  meta: { name: "metrics", description: "Show cpu/memory/network metrics for a resource" },
  args: {
    resource: {
      type: "positional",
      required: false,
      description: "Resource name (service or database)",
    },
    window: { type: "string", description: "Look-back window in minutes (1-1440, default 30)" },
    config: { type: "string", description: "Path to config file" },
    slug: { type: "string", description: "Project slug (defaults to config)" },
    url: { type: "string", description: "Override control plane URL" },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    const windowMinutes = args.window ? Number.parseInt(args.window, 10) : undefined;
    if (
      args.window &&
      (!Number.isInteger(windowMinutes) ||
        windowMinutes === undefined ||
        windowMinutes < 1 ||
        windowMinutes > 1440)
    ) {
      consola.error("--window must be an integer between 1 and 1440 (minutes).");
      process.exit(1);
    }

    const ctx = await resolveResource(args, args.resource);
    const result = await ctx.client.metrics.query({
      resourceId: ctx.resourceId,
      windowMinutes,
    });
    if (args.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    const { points } = result;
    const latest = points.at(-1);
    if (!latest) {
      consola.info(
        `No metric samples for ${ctx.resourceName} in the last ${windowMinutes ?? 30} minute(s).`,
      );
      return;
    }

    const cpu = stats(points.map((p) => p.cpuPct));
    const mem = stats(points.map((p) => p.memBytes));
    const memLimit = latest.memLimitBytes > 0 ? ` / ${formatBytes(latest.memLimitBytes)}` : "";
    consola.info(
      `${ctx.resourceName}: ${points.length} sample(s) over the last ${windowMinutes ?? 30}m, latest ${latest.ts.toISOString()}`,
    );
    consola.log(
      `cpu      now ${latest.cpuPct.toFixed(1)}%   min ${cpu.min.toFixed(1)}%  avg ${cpu.avg.toFixed(1)}%  max ${cpu.max.toFixed(1)}%`,
    );
    consola.log(
      `memory   now ${formatBytes(latest.memBytes)}${memLimit}   min ${formatBytes(mem.min)}  avg ${formatBytes(mem.avg)}  max ${formatBytes(mem.max)}`,
    );
    consola.log(
      `network  rx ${formatBytes(latest.netRxBytes)}  tx ${formatBytes(latest.netTxBytes)}`,
    );
  },
});
