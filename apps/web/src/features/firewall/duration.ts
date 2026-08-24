import { humanizeSeconds } from "@/shared/lib/time";

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
  return humanizeSeconds(total);
}
