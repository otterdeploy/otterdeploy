/**
 * Copy formatters for schedules: human cron summaries and the retention
 * one-liner. Split from shared.tsx (the badge/format grab-bag) for the line
 * budget; schedule-card is the consumer.
 */

const CRON_WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const CRON_NICKNAMES: Record<string, string> = {
  "@hourly": "Every hour on the hour",
  "@daily": "Every day at 00:00 UTC",
  "@midnight": "Every day at 00:00 UTC",
  "@weekly": "Every Sunday at 00:00 UTC",
  "@monthly": "Monthly on the 1st at 00:00 UTC",
  "@yearly": "Yearly on Jan 1st",
  "@annually": "Yearly on Jan 1st",
};

export function cronHuman(cron: string): string {
  const t = cron.trim();
  const nickname = CRON_NICKNAMES[t];
  if (nickname) return nickname;
  if (t === "0 * * * *") return "Every hour on the hour";
  const at = (h: string) => `${h.padStart(2, "0")}:00 UTC`;
  const daily = /^0 (\d{1,2}) \* \* \*$/.exec(t);
  if (daily?.[1]) return `Every day at ${at(daily[1])}`;
  const weekly = /^0 (\d{1,2}) \* \* (\d)$/.exec(t);
  if (weekly?.[1] && weekly[2] != null) {
    return `Every ${CRON_WEEKDAYS[Number(weekly[2]) % 7]} at ${at(weekly[1])}`;
  }
  const monthly = /^0 (\d{1,2}) (\d{1,2}) \* \*$/.exec(t);
  if (monthly?.[1] && monthly[2]) return `Monthly on day ${monthly[2]} at ${at(monthly[1])}`;
  return t;
}

/** Human retention summary from a schedule's GFS tiers + age/storage caps. */
export function retentionLabel(s: {
  keepLast?: number;
  keepHourly?: number;
  keepDaily: number;
  keepWeekly: number;
  keepMonthly: number;
  keepYearly: number;
  retentionDays: number | null;
  maxStorageGb: number | null;
}): string {
  const tiers: string[] = [];
  if (s.keepLast) tiers.push(`last ${s.keepLast}`);
  if (s.keepHourly) tiers.push(`${s.keepHourly}h`);
  if (s.keepDaily) tiers.push(`${s.keepDaily}d`);
  if (s.keepWeekly) tiers.push(`${s.keepWeekly}w`);
  if (s.keepMonthly) tiers.push(`${s.keepMonthly}mo`);
  if (s.keepYearly) tiers.push(`${s.keepYearly}y`);
  const parts: string[] = [];
  if (tiers.length) parts.push(`keep ${tiers.join("/")}`);
  if (s.retentionDays) parts.push(`${s.retentionDays}d max age`);
  if (s.maxStorageGb) parts.push(`${s.maxStorageGb}GB cap`);
  return parts.length ? parts.join(" · ") : "No retention policy";
}
