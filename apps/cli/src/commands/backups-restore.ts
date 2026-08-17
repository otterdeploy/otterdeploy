import { defineCommand } from "citty";

import { ensureAuthenticated } from "../auth-flow";
import { createCliClient } from "../client";
import { formatBytes, orAbsent, relativeTime, shortId } from "../lib/format";
import { cmd } from "../lib/name";
import {
  abort,
  ask,
  detail,
  dim,
  err,
  hint,
  note,
  ok,
  out,
  paint,
  row,
  section,
  warn,
} from "../lib/ui";

/** How many ambiguous matches to show before it stops being a useful list. */
const MAX_AMBIGUOUS = 10;

export const verifyBackupCommand = defineCommand({
  meta: {
    name: "verify",
    description: "Verify a backup by restoring it into a throwaway container",
  },
  args: {
    backupId: { type: "positional", required: true, description: "Backup id (bak_…, prefix ok)" },
    url: { type: "string", description: "Override control plane URL" },
  },
  async run({ args }) {
    const { url, token } = await ensureAuthenticated(args.url);
    const client = createCliClient({ url, token });

    const backups = await client.backups.list({});
    const matches = backups.filter((backup) => backup.id.startsWith(args.backupId));
    const backup =
      backups.find((candidate) => candidate.id === args.backupId) ??
      (matches.length === 1 ? matches[0] : undefined);
    if (!backup) {
      abort(
        `No backup \`${args.backupId}\` in this organization.`,
        `run \`${cmd("backups list")}\` to see them`,
      );
    }

    const started = await client.backups.verifyRestore({ id: backup.id });
    ok(`Verification started for ${shortId(backup.id)} (${started.status}).`);
    note("The snapshot is being restored into a sandbox; this can take a few minutes.");
    hint(`watch the run's detail drawer in the dashboard, or re-run \`${cmd("backups list")}\``);
  },
});

export const restoreBackupCommand = defineCommand({
  meta: {
    name: "restore",
    description: "Restore a backup in place (OVERWRITES the live database)",
  },
  args: {
    backupId: { type: "positional", required: true, description: "Backup id (bak_…, prefix ok)" },
    confirm: {
      type: "string",
      description: "Confirmation phrase (the database name) for non-interactive use",
    },
    url: { type: "string", description: "Override control plane URL" },
  },
  async run({ args }) {
    const { url, token } = await ensureAuthenticated(args.url);
    const client = createCliClient({ url, token });

    const backups = await client.backups.list({});
    const matches = backups.filter((backup) => backup.id.startsWith(args.backupId));
    const exact = backups.find((backup) => backup.id === args.backupId);
    const backup = exact ?? (matches.length === 1 ? matches[0] : undefined);
    if (!backup) {
      if (matches.length > 1) {
        err();
        for (const match of matches.slice(0, MAX_AMBIGUOUS)) {
          row([
            paint("id", match.id),
            orAbsent(match.source),
            dim(relativeTime(String(match.createdAt))),
          ]);
        }
        err();
        abort(`\`${args.backupId}\` matches ${matches.length} backups.`, "use a longer id");
      }
      abort(
        `No backup \`${args.backupId}\` in this organization.`,
        `run \`${cmd("backups list")}\` to see them`,
      );
    }
    if (backup.status !== "succeeded") {
      abort(
        `Backup ${shortId(backup.id)} is ${backup.status}. Only succeeded backups restore.`,
        `run \`${cmd("backups list")}\` to find a completed one`,
      );
    }

    const expected = backup.source ?? backup.resourceId;
    if (!expected) {
      abort(
        `Backup ${shortId(backup.id)} records no database name to confirm against.`,
        "restore it from the dashboard instead",
      );
    }
    section("In-place restore");
    detail([
      ["database", paint("danger", expected)],
      [
        "backup",
        `${paint("id", shortId(backup.id))} ${dim(relativeTime(String(backup.createdAt)))}`,
      ],
      ["size", dim(formatBytes(backup.compressedSizeBytes ?? backup.sourceSizeBytes))],
    ]);
    out();
    warn(`This OVERWRITES the live database "${expected}". It cannot be undone.`);

    let confirmation = args.confirm;
    if (!confirmation) {
      if (!process.stdin.isTTY) {
        abort("Non-interactive session.", `pass \`--confirm "${expected}"\` to proceed`);
      }
      confirmation = (await ask(`Type "${expected}" to confirm`)) ?? "";
    }
    if (confirmation !== expected && confirmation !== backup.resourceId) {
      abort("Confirmation did not match. Nothing was restored.");
    }

    const result = await client.backups.restore({
      id: backup.id,
      mode: "in-place",
      confirm: confirmation,
    });
    if (result.ok) ok(`Restored ${expected} from ${shortId(backup.id)}.`);
  },
});
