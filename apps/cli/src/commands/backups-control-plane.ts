/**
 * `otterdeploy backups control-plane` — the operator-facing surface for
 * od-5j8.13's readiness question: "could I actually recover this install
 * right now?" Every subcommand is a thin call onto
 * `backups.controlPlane.*` (install-admin only — see
 * packages/api/src/routers/backups/control-plane-contract.ts).
 *
 * `generate-key` is the AUTHENTICATED counterpart to the offline
 * `otterdeploy recovery-key generate` (recovery-key.ts): this one registers
 * the key's fingerprint with the control plane so the readiness surface can
 * confirm one exists. Prefer this one during normal operation; the offline
 * command exists for the restore path, where there is no server to talk to.
 */
import { defineCommand } from "citty";

import { ensureAuthenticated } from "../auth-flow";
import { createCliClient } from "../client";
import { cmd } from "../lib/name";
import { abort, ask, detail, dim, hint, ok, out, paint, section, warn } from "../lib/ui";
import type { Role } from "../lib/ui";

const LEVEL_ROLE: Record<string, Role> = {
  ready: "ok",
  degraded: "warn",
  not_ready: "danger",
};

function printReadiness(view: {
  level: string;
  reasons: string[];
  lastBackupAgeHours: number | null;
  backupEnabled: boolean;
  destinationConfigured: boolean;
  destinationName: string | null;
  destinationReachable: boolean | null;
  recoveryKeyFingerprint: string | null;
  recoveryKeyExportedAt: Date | null;
  lastRunStatus: string | null;
  lastRunAt: Date | null;
}): void {
  const role = LEVEL_ROLE[view.level] ?? "warn";
  section("Control-plane recovery readiness");
  out(paint(role, view.level.toUpperCase().replace("_", " ")));
  if (view.reasons.length > 0) {
    out();
    for (const reason of view.reasons) warn(reason);
  }
  out();
  detail([
    ["backups enabled", view.backupEnabled ? "yes" : "no"],
    [
      "destination",
      view.destinationConfigured
        ? `${view.destinationName ?? "?"} (${view.destinationReachable ? "structurally valid" : "check failed"})`
        : dim("not configured"),
    ],
    [
      "recovery key",
      view.recoveryKeyFingerprint
        ? `${dim(view.recoveryKeyFingerprint)}${view.recoveryKeyExportedAt ? "" : " (NOT confirmed exported)"}`
        : dim("not generated"),
    ],
    [
      "last successful backup",
      view.lastBackupAgeHours != null ? `${Math.floor(view.lastBackupAgeHours)}h ago` : dim("never"),
    ],
    ["last run", view.lastRunStatus ? `${view.lastRunStatus}` : dim("never run")],
  ]);
}

const statusCmd = defineCommand({
  meta: { name: "status", description: "Show control-plane backup recovery readiness" },
  args: {
    url: { type: "string", description: "Override control plane URL" },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    const { url, token } = await ensureAuthenticated(args.url);
    const client = createCliClient({ url, token });
    const view = await client.backups.controlPlane.readiness({});
    if (args.json) {
      out(JSON.stringify(view, null, 2));
      return;
    }
    printReadiness(view);
  },
});

const generateKeyCmd = defineCommand({
  meta: {
    name: "generate-key",
    description: "Generate a control-plane recovery key and register its fingerprint",
  },
  args: {
    url: { type: "string", description: "Override control plane URL" },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    const { url, token } = await ensureAuthenticated(args.url);
    const client = createCliClient({ url, token });
    const generated = await client.backups.controlPlane.recoveryKey.generate({});
    if (args.json) {
      out(JSON.stringify(generated, null, 2));
      return;
    }
    warn("This key is shown ONCE. Save it off this host right now — it is never stored or shown again.");
    out("");
    out(generated.displayKey);
    out("");
    detail([["fingerprint", dim(generated.fingerprint)]]);
    hint(`once it's saved: \`${cmd("backups control-plane confirm-key-exported")}\``);
  },
});

const confirmKeyExportedCmd = defineCommand({
  meta: {
    name: "confirm-key-exported",
    description: "Confirm the last generated recovery key was saved off-host",
  },
  args: {
    url: { type: "string", description: "Override control plane URL" },
    yes: { type: "boolean", description: "Skip the confirmation prompt" },
  },
  async run({ args }) {
    if (!args.yes) {
      if (!process.stdin.isTTY) {
        abort("Non-interactive session.", "pass --yes once the key is actually saved off-host");
      }
      const answer = await ask("Have you saved the recovery key somewhere off this host? (yes/no)");
      if (answer?.trim().toLowerCase() !== "yes") {
        abort("Not confirmed — readiness will keep reporting the key as unexported.");
      }
    }
    const { url, token } = await ensureAuthenticated(args.url);
    const client = createCliClient({ url, token });
    const view = await client.backups.controlPlane.recoveryKey.confirmExported({});
    ok("Recovery key marked as exported.");
    printReadiness(view);
  },
});

const configureCmd = defineCommand({
  meta: { name: "configure", description: "Set the control-plane backup destination + enable/disable" },
  args: {
    destination: { type: "string", description: "Backup destination id (from `backups destinations list`)" },
    clear: { type: "boolean", description: "Clear the configured destination" },
    enable: { type: "boolean", description: "Enable control-plane backups" },
    disable: { type: "boolean", description: "Disable control-plane backups" },
    url: { type: "string", description: "Override control plane URL" },
  },
  async run({ args }) {
    const { url, token } = await ensureAuthenticated(args.url);
    const client = createCliClient({ url, token });
    if (args.enable && args.disable) abort("Pass at most one of --enable / --disable.");
    if (args.destination && args.clear) abort("Pass at most one of --destination / --clear.");

    const current = await client.backups.controlPlane.readiness({});
    const destinationId = args.clear
      ? null
      : (args.destination ?? current.destinationId ?? null);
    const view = await client.backups.controlPlane.configure({
      destinationId,
      enabled: args.enable ? true : args.disable ? false : current.backupEnabled,
    });
    ok("Control-plane backup configuration updated.");
    printReadiness(view);
  },
});

export const controlPlaneCommand = defineCommand({
  meta: { name: "control-plane", description: "Whole-control-plane backup + disaster-recovery status" },
  subCommands: {
    status: statusCmd,
    "generate-key": generateKeyCmd,
    "confirm-key-exported": confirmKeyExportedCmd,
    configure: configureCmd,
  },
});
