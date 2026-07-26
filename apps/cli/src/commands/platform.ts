import { defineCommand } from "citty";

import type { CliClient } from "../lib/resolve";

import { ensureAuthenticated } from "../auth-flow";
import { createCliClient } from "../client";
import { formatBytes } from "../lib/format";
import {
  abort,
  confirm,
  detail,
  dim,
  fail,
  note,
  ok,
  out,
  paint,
  section,
  table,
  warn,
} from "../lib/ui";

async function connect(urlOverride?: string): Promise<CliClient> {
  const { url, token } = await ensureAuthenticated(urlOverride);
  return createCliClient({ url, token });
}

const platformVersion = defineCommand({
  meta: { name: "version", description: "Show the platform version, channel, and runtime" },
  args: {
    url: { type: "string", description: "Override control plane URL" },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    const client = await connect(args.url);
    const info = await client.system.version({});
    if (args.json) {
      process.stdout.write(`${JSON.stringify(info, null, 2)}\n`);
      return;
    }
    section("Platform");
    detail([
      ["version", info.current],
      ["channel", info.channel],
      ["runtime", dim(info.runtime)],
    ]);
    if (info.dryRun) note("Updates run in dry-run mode on this install.");
  },
});

interface UsageSection {
  count: number;
  totalBytes: number;
  reclaimableBytes: number;
}

/** A percentage that turns amber then red as it approaches full. */
function usageValue(usedPct: number, text: string): string {
  const HIGH = 90;
  const ELEVATED = 75;
  if (usedPct >= HIGH) return paint("danger", text);
  if (usedPct >= ELEVATED) return paint("warn", text);
  return text;
}

const platformHealth = defineCommand({
  meta: { name: "health", description: "Host health: memory, disk, and docker usage" },
  args: {
    url: { type: "string", description: "Override control plane URL" },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    const client = await connect(args.url);
    const health = await client.system.hostHealth({});
    if (args.json) {
      process.stdout.write(`${JSON.stringify(health, null, 2)}\n`);
      return;
    }

    const mem = health.memory;
    const capacity: Array<[string, string]> = [
      [
        "memory",
        usageValue(
          mem.usedPct,
          `${formatBytes(mem.totalBytes - mem.availableBytes)} / ${formatBytes(mem.totalBytes)}  ${mem.usedPct.toFixed(0)}%`,
        ),
      ],
    ];
    if (health.disk) {
      const disk = health.disk;
      capacity.push([
        "disk",
        `${usageValue(
          disk.usedPct,
          `${formatBytes(disk.totalBytes - disk.freeBytes)} / ${formatBytes(disk.totalBytes)}  ${disk.usedPct.toFixed(0)}%`,
        )} ${dim(disk.path)}`,
      ]);
    }
    if (health.branchPool) {
      const pool = health.branchPool;
      const free = pool.freeBytes === null ? "?" : formatBytes(pool.freeBytes);
      const size = pool.sizeBytes === null ? "?" : formatBytes(pool.sizeBytes);
      capacity.push([
        "zfs pool",
        `${free} free of ${size} ${dim(pool.pool)}${pool.health ? ` ${dim(pool.health)}` : ""}`,
      ]);
    }
    section("Capacity");
    detail(capacity);

    if (health.docker) {
      const sections: Array<[string, UsageSection]> = [
        ["images", health.docker.images],
        ["containers", health.docker.containers],
        ["volumes", health.docker.volumes],
        ["build cache", health.docker.buildCache],
      ];
      section("Docker");
      table(
        [
          { header: "" },
          { header: "count", align: "right" },
          { header: "size", align: "right" },
          { header: "reclaimable", align: "right" },
        ],
        sections.map(([label, s]) => [
          label,
          dim(String(s.count)),
          formatBytes(s.totalBytes),
          // Reclaimable space is the actionable number here, so it stays
          // undimmed when there is any to reclaim.
          s.reclaimableBytes > 0 ? formatBytes(s.reclaimableBytes) : dim(formatBytes(0)),
        ]),
      );
    }

    out();
    if (health.recommendations.length === 0) {
      ok("No recommendations — host looks healthy.");
      return;
    }
    // Every recommendation is reported. A `critical` one used to be printed with
    // consola.error, which does not exit — keep that, because aborting on the
    // first critical would hide the rest of the host's problems.
    section("Recommendations");
    for (const rec of health.recommendations) {
      const text = `${rec.title} — ${rec.detail}`;
      if (rec.severity === "critical") fail(text);
      else if (rec.severity === "warning") warn(text);
      else note(text);
    }
    // Critical findings still set a non-zero exit so monitoring can gate on it.
    if (health.recommendations.some((r) => r.severity === "critical")) process.exitCode = 1;
  },
});

const updateCheck = defineCommand({
  meta: { name: "check", description: "Check for a platform update" },
  args: {
    url: { type: "string", description: "Override control plane URL" },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    const client = await connect(args.url);
    const result = await client.system.checkForUpdate({});
    if (args.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    if (result.simulated) {
      warn("Simulated check (OTTERDEPLOY_LATEST_VERSION_OVERRIDE is set).");
    }
    if (result.updateAvailable && result.latest) {
      note(`Update available: ${result.current} → ${paint("accent", result.latest)}`);
      if (result.url) detail([["notes", dim(result.url)]]);
      return;
    }
    if (result.latest === null) {
      warn(`Could not reach the release source; current version is ${result.current}.`);
      return;
    }
    ok(`Up to date (${result.current}).`);
  },
});

const updateApply = defineCommand({
  meta: { name: "apply", description: "Apply the latest platform update" },
  args: {
    url: { type: "string", description: "Override control plane URL" },
    yes: { type: "boolean", description: "Skip the confirmation prompt" },
  },
  async run({ args }) {
    const client = await connect(args.url);
    const check = await client.system.checkForUpdate({});
    if (!check.updateAvailable || !check.latest) {
      ok(`Already up to date (${check.current}).`);
      return;
    }
    note(`Update available: ${check.current} → ${paint("accent", check.latest)}`);
    if (!args.yes) {
      // This MUST stop when declined. The previous version printed "Aborted."
      // and then applied the update anyway.
      if (!(await confirm(`Update the platform to ${check.latest}?`))) {
        abort("Aborted — the platform was not updated.");
      }
    }
    const result = await client.system.apply({});
    if (!result.started) {
      const reasons: Record<"already-running" | "no-update" | "downgrade", string> = {
        "already-running": "An update is already running.",
        "no-update": "No update is available anymore.",
        downgrade: "The target version is older than the current version.",
      };
      abort(reasons[result.reason]);
    }
    ok(`Update to ${result.targetVersion} started${result.dryRun ? " (dry run)" : ""}.`);
    // The apply is fire-and-forget: a detached helper pulls new images,
    // migrates, and recreates the control plane — polling from here would
    // die mid-restart, so hand off to the dashboard instead.
    note(
      dim(
        "It runs detached on the host; the control plane restarts itself and the dashboard reloads once the new version is healthy.",
      ),
    );
  },
});

const platformUpdate = defineCommand({
  meta: { name: "update", description: "Check for and apply platform updates" },
  subCommands: {
    check: updateCheck,
    apply: updateApply,
  },
});

export const platformCommand = defineCommand({
  meta: { name: "platform", description: "Platform version, host health, and updates" },
  subCommands: {
    version: platformVersion,
    health: platformHealth,
    update: platformUpdate,
  },
});
