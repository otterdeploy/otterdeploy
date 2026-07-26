/**
 * SSRF-safe, blue/green managed blocklist sync.
 *
 * The control plane resolves and validates every URL/redirect hop, pins the
 * validated public address for the socket, bounds download time/size, and
 * reduces the body to IP/CIDR lines. Only that sanitized payload is streamed
 * to CrowdSec stdin. Rules are imported into the inactive :a/:b scenario
 * before the previous generation is removed, preserving last-known-good
 * enforcement across bad downloads, import failures, and process crashes.
 */
import { fetchPublicText } from "../../security/public-fetch";
import { parseBlocklistContent } from "./blocklist-content";
import { blocklistEgressDenylist } from "./blocklist-egress";
import { cscliRun } from "./cscli";
import { setBlocklistSyncResult, type BlocklistRow } from "./queries";

const IMPORT_SCRIPT =
  `tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT; ` +
  `cat > "$tmp"; ` +
  `if [ ! -s "$tmp" ]; then echo "Import failed: empty validated list"; exit 1; fi; ` +
  `cscli decisions import -i "$tmp" --format values --duration "$2" --reason "$1"`;

const legacyScenario = (id: string) => `blocklist:${id}`;
const slotScenario = (id: string, slot: "a" | "b") => `${legacyScenario(id)}:${slot}`;

export interface SyncResult {
  ok: boolean;
  count: number;
  error?: string;
}

function lastOutput(out: string, fallback: string): string {
  return out.trim().split("\n").filter(Boolean).slice(-2).join(" ").slice(0, 300) || fallback;
}

async function clearScenario(scenario: string): Promise<boolean> {
  const out = await cscliRun(`cscli decisions delete --scenario "$1"`, [scenario]);
  return out !== null && !/error|invalid|failed|denied|unable/i.test(out);
}

async function fetchEntries(url: string): Promise<string[]> {
  const denylist = await blocklistEgressDenylist();
  const fetched = await fetchPublicText(url, {
    ...denylist,
    maxBytes: 8 * 1024 * 1024,
    maxRedirects: 5,
    timeoutMs: 15_000,
  });
  return parseBlocklistContent(fetched.text);
}

function nextScenario(row: BlocklistRow): string {
  return row.activeScenario === slotScenario(row.id, "a")
    ? slotScenario(row.id, "b")
    : slotScenario(row.id, "a");
}

export async function syncBlocklist(
  row: BlocklistRow,
  prefetchedEntries?: string[],
): Promise<SyncResult> {
  await setBlocklistSyncResult(row.id, { status: "pending" });

  let entries: string[];
  try {
    entries = prefetchedEntries ?? (await fetchEntries(row.url));
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    await setBlocklistSyncResult(row.id, { status: "error", error });
    return { ok: false, count: 0, error };
  }

  const scenario = nextScenario(row);
  // Remove a stale inactive generation left by a crash. The active generation
  // remains untouched until the replacement import is confirmed and persisted.
  if (!(await clearScenario(scenario))) {
    const error = "CrowdSec could not prepare the inactive blocklist generation.";
    await setBlocklistSyncResult(row.id, { status: "error", error });
    return { ok: false, count: 0, error };
  }
  const out = await cscliRun(IMPORT_SCRIPT, [scenario, `${row.durationHours}h`], {
    input: `${entries.join("\n")}\n`,
    timeoutMs: 180_000,
  });
  if (out === null) {
    const error = "CrowdSec agent isn't running — start the firewall profile.";
    await setBlocklistSyncResult(row.id, { status: "error", error });
    return { ok: false, count: 0, error };
  }

  const match = out.match(/Imported\s+(\d+)/i) ?? out.match(/(\d+)\s+decision/i);
  if (!match || /error|invalid|failed|denied|unable|timed out/i.test(out)) {
    const error = lastOutput(out, "CrowdSec rejected the validated blocklist.");
    await setBlocklistSyncResult(row.id, { status: "error", error });
    return { ok: false, count: 0, error };
  }

  const count = Number(match[1]);
  if (!Number.isSafeInteger(count) || count < 1) {
    const error = "CrowdSec imported no decisions.";
    await setBlocklistSyncResult(row.id, { status: "error", error });
    return { ok: false, count: 0, error };
  }

  // Persist the new active generation before deleting the old one. A crash
  // leaves duplicate enforcement, never a gap; the next inactive-slot cleanup
  // removes that stale generation.
  await setBlocklistSyncResult(row.id, { status: "ok", count, activeScenario: scenario });
  const previous = row.activeScenario ?? legacyScenario(row.id);
  const cleaned = previous === scenario || (await clearScenario(previous));
  return {
    ok: true,
    count,
    error: cleaned ? undefined : "Replacement active; stale CrowdSec rules remain until next sync.",
  };
}

export async function validateBlocklistSource(url: string): Promise<string[]> {
  return fetchEntries(url);
}

/** Remove every possible generation so delete/disable remains reversible even
 * after a crash between CrowdSec and database state transitions. */
export async function clearBlocklist(row: BlocklistRow): Promise<boolean> {
  const current = row.activeScenario ?? legacyScenario(row.id);
  const scenarios = new Set([
    legacyScenario(row.id),
    slotScenario(row.id, "a"),
    slotScenario(row.id, "b"),
    ...(row.activeScenario ? [row.activeScenario] : []),
  ]);
  scenarios.delete(current);
  for (const scenario of [...scenarios, current]) {
    if (!(await clearScenario(scenario))) return false;
  }
  return true;
}
