import { humanizeSeconds } from "@/shared/lib/time";

/**
 * Past this much time left, a ban is one an operator asked to last forever.
 *
 * CrowdSec has no infinite decision, so "permanent" is written as a hundred
 * years (`PERMANENT_BAN_HOURS`). Ten years is the dividing line because the
 * longest FINITE ban the UI offers is 180 days: nothing between the two exists,
 * so the test never has to be close.
 */
const PERMANENT_SECONDS = 10 * 365 * 86_400;

/** Humanize CrowdSec's Go-style remaining durations ("717h30m27s") into the
 *  two most significant units ("29d 21h"): the raw string is illegible past
 *  a day or two. Unparseable input passes through untouched. */
export function humanizeGoDuration(raw: string): string {
  const m = /^(-)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/.exec(raw.trim());
  if (!m || (!m[2] && !m[3] && !m[4])) return raw;
  const total = Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
  // A ban whose remaining time is negative or zero has already lapsed, which
  // is a different statement from "0 seconds left".
  if (m[1] || total <= 0) return "expired";
  // "36500d" is a true answer to a question nobody asked. The operator chose
  // "forever", so say forever.
  if (total >= PERMANENT_SECONDS) return "permanent";
  return humanizeSeconds(total);
}
