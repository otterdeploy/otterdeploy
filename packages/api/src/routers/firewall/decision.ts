/**
 * Add / remove a single manual CrowdSec decision — the "Block this IP" action
 * from the Edge Logs and Firewall views. Enforcement needs NO Caddy reload: the
 * `crowdsec` gate is already in every site block, and the in-Caddy bouncer polls
 * the decision store. The IP/reason are passed to `cscli` as positional args
 * ($1…), never interpolated, so a hostile value can't inject shell.
 *
 * Manual decisions carry `--reason manual:<actorId>` so they're distinguishable
 * from imported blocklist decisions (`blocklist:<id>`) and community feeds.
 */
import { cscliRun } from "./cscli";

export interface BlockResult {
  ok: boolean;
  error?: string;
}

const AGENT_DOWN = "CrowdSec firewall profile isn't running — start it to enforce blocks.";

/** cscli prints result messages to stdout/stderr (merged by the Tty exec); a
 *  failure mentions one of these. Mirrors the console-enroll check in index.ts. */
const FAILED = /error|invalid|failed|denied|unable|could ?n['o]t|not found/i;

/** Last non-empty output line, trimmed to a toast-friendly length. */
function lastLine(out: string, fallback: string): string {
  return out.trim().split("\n").filter(Boolean).at(-1)?.slice(0, 200) || fallback;
}

/** Map a `cscliRun` result to a BlockResult: null ⇒ agent down; output matching
 *  a failure signature ⇒ error (last line as the message); otherwise success.
 *  Pure + exported so the branching is unit-tested without a Docker exec. */
export function interpretCscli(out: string | null, failFallback: string): BlockResult {
  if (out === null) return { ok: false, error: AGENT_DOWN };
  if (FAILED.test(out)) return { ok: false, error: lastLine(out, failFallback) };
  return { ok: true };
}

/** Ban an IP (or CIDR) for `durationHours`. */
export async function blockIp(
  ip: string,
  durationHours: number,
  reason: string,
): Promise<BlockResult> {
  const out = await cscliRun(
    `cscli decisions add --ip "$1" --duration "$2" --type ban --reason "$3"`,
    [ip, `${durationHours}h`, reason],
  );
  return interpretCscli(out, "Block failed");
}

/**
 * Ban a batch of IPs in one container exec — one `cscli decisions add` per IP
 * inside a single shell loop, so 100 IPs cost one exec, not 100. Each add is a
 * proper `cscli`-origin decision (NOT a `decisions import`, whose
 * `cscli-import` origin would hide the bans from the Decisions view). ~100 to
 * 300ms per add, hence the generous exec timeout.
 */
export async function blockManyIps(
  ips: string[],
  durationHours: number,
  reason: string,
): Promise<{ ok: boolean; blocked: number; error?: string }> {
  const out = await cscliRun(
    `d="$1"; r="$2"; shift 2; n=0; ` +
      `for ip in "$@"; do ` +
      `cscli decisions add --ip "$ip" --duration "$d" --type ban --reason "$r" >/dev/null 2>&1 && n=$((n+1)); ` +
      `done; echo "blocked $n"`,
    [`${durationHours}h`, reason, ...ips],
    { timeoutMs: 180_000 },
  );
  if (out === null) return { ok: false, blocked: 0, error: AGENT_DOWN };
  const blocked = Number(out.match(/blocked\s+(\d+)/)?.[1] ?? 0);
  if (blocked === 0) return { ok: false, blocked: 0, error: lastLine(out, "Block failed") };
  return { ok: true, blocked };
}

/** Remove every decision targeting `ip` (undoes a manual block; also clears a
 *  community/blocklist ban on that exact IP). */
export async function unblockIp(ip: string): Promise<BlockResult> {
  const out = await cscliRun(`cscli decisions delete --ip "$1"`, [ip]);
  return interpretCscli(out, "Unblock failed");
}
