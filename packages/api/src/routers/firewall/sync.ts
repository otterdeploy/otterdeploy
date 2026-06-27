/**
 * Sync a managed blocklist into CrowdSec. The whole fetch → strip comments →
 * import pipeline runs INSIDE the agent container in one shell, with the list
 * URL / reason / duration passed as positional args ($1/$2/$3) so a hostile URL
 * can't inject shell. Imported decisions carry `--reason blocklist:<id>` so a
 * re-sync refreshes them and a delete clears exactly this list (they'd also
 * expire after `durationHours` on their own).
 */
import { cscliRun } from "./cscli";
import { setBlocklistSyncResult, type BlocklistRow } from "./queries";

// $1 = url, $2 = reason, $3 = duration (e.g. "24h"). curl if present, else wget.
const IMPORT_SCRIPT =
  `(command -v curl >/dev/null 2>&1 && curl -fsSL "$1" || wget -qO- "$1") ` +
  `| grep -vE '^[[:space:]]*[#;]' | awk 'NF{print $1}' ` +
  `| cscli decisions import -i /dev/stdin --format values --duration "$3" --reason "$2"`;

const reasonFor = (id: string) => `blocklist:${id}`;

export interface SyncResult {
  ok: boolean;
  count: number;
  error?: string;
}

export async function syncBlocklist(row: BlocklistRow): Promise<SyncResult> {
  const out = await cscliRun(IMPORT_SCRIPT, [row.url, reasonFor(row.id), `${row.durationHours}h`]);

  if (out === null) {
    const error = "CrowdSec agent isn't running — start the firewall profile.";
    await setBlocklistSyncResult(row.id, { status: "error", error });
    return { ok: false, count: 0, error };
  }

  // cscli prints e.g. "Imported 1234 decisions".
  const match = out.match(/Imported\s+(\d+)/i) ?? out.match(/(\d+)\s+decision/i);
  const lower = out.toLowerCase();
  const looksFailed =
    !match && /error|could not|couldn't|no such|unable|failed|not found|timed out/.test(lower);

  if (looksFailed) {
    const error =
      out.trim().split("\n").filter(Boolean).slice(-2).join(" ").slice(0, 300) || "Import failed";
    await setBlocklistSyncResult(row.id, { status: "error", error });
    return { ok: false, count: 0, error };
  }

  const count = match ? Number(match[1]) : 0;
  await setBlocklistSyncResult(row.id, { status: "ok", count });
  return { ok: true, count };
}

/** Best-effort removal of a list's decisions (also self-expire by duration). */
export async function clearBlocklist(row: BlocklistRow): Promise<void> {
  await cscliRun(`cscli decisions delete --scenario "$1" >/dev/null 2>&1 || true`, [
    reasonFor(row.id),
  ]);
}
