/**
 * Sync a managed blocklist into CrowdSec. The whole fetch → strip comments →
 * import pipeline runs INSIDE the agent container in one shell, with the list
 * URL / reason / duration passed as positional args ($1/$2/$3) so a hostile URL
 * can't inject shell. Imported decisions carry `--reason blocklist:<id>` so a
 * delete clears exactly this list (they'd also expire after `durationHours`).
 *
 * Each sync REPLACES the list: the previous batch is deleted by scenario
 * before the import. `cscli decisions import` only ever inserts — without the
 * delete, every interval stacked another full copy (30-day durations × 3h
 * intervals grew the agent DB to ~500k live decisions / 190MB, grinding the
 * LAPI into "database is locked" territory).
 */
import { cscliRun } from "./cscli";
import { setBlocklistSyncResult, type BlocklistRow } from "./queries";

// $1 = url, $2 = reason, $3 = duration (e.g. "24h"). curl if present, else
// wget. Fetch lands in a temp file first so a failed/empty download keeps the
// previous batch enforcing instead of deleting it and importing nothing.
const IMPORT_SCRIPT =
  `tmp="$(mktemp)"; ` +
  `(command -v curl >/dev/null 2>&1 && curl -fsSL "$1" || wget -qO- "$1") ` +
  `| grep -vE '^[[:space:]]*[#;]' | awk 'NF{print $1}' > "$tmp"; ` +
  `if [ -s "$tmp" ]; then ` +
  `cscli decisions delete --scenario "$2" >/dev/null 2>&1 || true; ` +
  `cscli decisions import -i "$tmp" --format values --duration "$3" --reason "$2"; ` +
  `else echo "Import failed: list download was empty or unreachable"; fi; ` +
  `rm -f "$tmp"`;

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
