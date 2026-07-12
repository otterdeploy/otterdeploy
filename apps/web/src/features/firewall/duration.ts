/** Humanize CrowdSec's Go-style remaining durations ("717h30m27s") into the
 *  two most significant units ("29d 21h") — the raw string is illegible past
 *  a day or two. Unparseable input passes through untouched. */
export function humanizeGoDuration(raw: string): string {
  const m = /^(-)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/.exec(raw.trim());
  if (!m || (!m[2] && !m[3] && !m[4])) return raw;
  const total = Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
  if (m[1] || total <= 0) return "expired";
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const mins = Math.floor((total % 3600) / 60);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  if (mins > 0) return `${mins}m`;
  return "<1m";
}
