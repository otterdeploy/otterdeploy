import { defineCommand } from "citty";

import { formatBytes, relativeTime } from "../lib/format";
import { resolveResource } from "../lib/resolve";
import { abort, detail, dim, note, section, table } from "../lib/ui";

const DEFAULT_WINDOW_MINUTES = 30;
const MAX_WINDOW_MINUTES = 1440;

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
        windowMinutes > MAX_WINDOW_MINUTES)
    ) {
      abort(
        "--window must be a whole number of minutes between 1 and 1440.",
        "for example `--window 60`",
      );
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
    const window = windowMinutes ?? DEFAULT_WINDOW_MINUTES;
    if (!latest) {
      note(`No metric samples for ${ctx.resourceName} in the last ${window}m.`);
      return;
    }

    const cpu = stats(points.map((p) => p.cpuPct));
    const mem = stats(points.map((p) => p.memBytes));

    section(`Metrics ${dim(ctx.resourceName)}`);
    detail([
      ["window", dim(`${window}m · ${points.length} samples`)],
      ["latest", dim(relativeTime(latest.ts.toISOString()))],
      ["limit", latest.memLimitBytes > 0 ? formatBytes(latest.memLimitBytes) : dim("unlimited")],
    ]);

    // now/min/avg/max as columns rather than one long line: the point of these
    // numbers is comparison, and comparison wants them stacked.
    table(
      [
        { header: "" },
        { header: "now", align: "right" },
        { header: "min", align: "right" },
        { header: "avg", align: "right" },
        { header: "max", align: "right" },
      ],
      [
        [
          "cpu",
          `${latest.cpuPct.toFixed(1)}%`,
          dim(`${cpu.min.toFixed(1)}%`),
          dim(`${cpu.avg.toFixed(1)}%`),
          dim(`${cpu.max.toFixed(1)}%`),
        ],
        [
          "memory",
          formatBytes(latest.memBytes),
          dim(formatBytes(mem.min)),
          dim(formatBytes(mem.avg)),
          dim(formatBytes(mem.max)),
        ],
      ],
    );

    section("Network");
    detail([
      ["rx", formatBytes(latest.netRxBytes)],
      ["tx", formatBytes(latest.netTxBytes)],
    ]);
  },
});
