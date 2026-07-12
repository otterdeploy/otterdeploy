import { defineCommand } from "citty";
import { consola } from "consola";

import type { CliClient } from "../lib/resolve";

import { ensureAuthenticated } from "../auth-flow";
import { createCliClient } from "../client";

async function connect(urlOverride?: string): Promise<CliClient> {
  const { url, token } = await ensureAuthenticated(urlOverride);
  return createCliClient({ url, token });
}

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
    consola.log(`version  ${info.current}`);
    consola.log(`channel  ${info.channel}`);
    consola.log(`runtime  ${info.runtime}`);
    if (info.dryRun) consola.info("Updates run in dry-run mode on this install.");
  },
});

interface UsageSection {
  count: number;
  totalBytes: number;
  reclaimableBytes: number;
}

function usageRow(label: string, section: UsageSection): string {
  const size = formatBytes(section.totalBytes).padStart(10);
  const reclaimable = formatBytes(section.reclaimableBytes);
  return `  ${label.padEnd(12)} ${String(section.count).padStart(4)}  ${size}  (${reclaimable} reclaimable)`;
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
    const memUsed = formatBytes(mem.totalBytes - mem.availableBytes);
    consola.log(
      `memory   ${memUsed} / ${formatBytes(mem.totalBytes)} (${mem.usedPct.toFixed(0)}% used)`,
    );
    if (health.disk) {
      const disk = health.disk;
      const diskUsed = formatBytes(disk.totalBytes - disk.freeBytes);
      consola.log(
        `disk     ${diskUsed} / ${formatBytes(disk.totalBytes)} (${disk.usedPct.toFixed(0)}% used) on ${disk.path}`,
      );
    }
    if (health.docker) {
      consola.log("docker");
      consola.log(usageRow("images", health.docker.images));
      consola.log(usageRow("containers", health.docker.containers));
      consola.log(usageRow("volumes", health.docker.volumes));
      consola.log(usageRow("build cache", health.docker.buildCache));
    }
    if (health.branchPool) {
      const pool = health.branchPool;
      const free = pool.freeBytes === null ? "?" : formatBytes(pool.freeBytes);
      const size = pool.sizeBytes === null ? "?" : formatBytes(pool.sizeBytes);
      const status = pool.health ? `  health ${pool.health}` : "";
      consola.log(`zfs pool ${pool.pool}  ${free} free of ${size}${status}`);
    }

    if (health.recommendations.length === 0) {
      consola.success("No recommendations — host looks healthy.");
      return;
    }
    for (const rec of health.recommendations) {
      const line = `${rec.title} — ${rec.detail}`;
      if (rec.severity === "critical") consola.error(line);
      else if (rec.severity === "warning") consola.warn(line);
      else consola.info(line);
    }
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
      consola.warn("Simulated check (OTTERDEPLOY_LATEST_VERSION_OVERRIDE is set).");
    }
    if (result.updateAvailable && result.latest) {
      consola.info(`Update available: ${result.current} → ${result.latest}`);
      if (result.url) consola.log(`Release notes: ${result.url}`);
    } else if (result.latest === null) {
      consola.warn(`Could not reach the release source; current version is ${result.current}.`);
    } else {
      consola.success(`Up to date (${result.current}).`);
    }
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
      consola.success(`Already up to date (${check.current}).`);
      return;
    }
    consola.info(`Update available: ${check.current} → ${check.latest}`);
    if (!args.yes) {
      const ok = await consola.prompt(`Update the platform to ${check.latest}?`, {
        type: "confirm",
        initial: false,
      });
      if (!ok) {
        consola.info("Aborted.");
        process.exit(1);
      }
    }
    const result = await client.system.apply({});
    if (!result.started) {
      const reasons: Record<"already-running" | "no-update" | "downgrade", string> = {
        "already-running": "An update is already running.",
        "no-update": "No update is available anymore.",
        downgrade: "The target version is older than the current version.",
      };
      consola.error(reasons[result.reason]);
      process.exit(1);
    }
    consola.success(
      `Update to ${result.targetVersion} started${result.dryRun ? " (dry run)" : ""}.`,
    );
    // The apply is fire-and-forget: a detached helper pulls new images,
    // migrates, and recreates the control plane — polling from here would
    // die mid-restart, so hand off to the dashboard instead.
    consola.info(
      "The update runs detached on the host; the control plane restarts itself and the dashboard reloads once the new version is healthy.",
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
