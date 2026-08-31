/**
 * Every ban length the UI offers, in one list.
 *
 * It used to live inside the manual "Block IP" popover, which is why that
 * popover was the only place you could choose one — a row's Block button always
 * meant thirty days, and there was no way at all to say "never let this address
 * back". Both surfaces read this now, so they can never disagree about what
 * "7 days" means or which lengths exist.
 *
 * Labels are i18n keys, not text: "7 days" pluralises and declines differently
 * per language, so the string has to be resolved at render.
 */
import { DEFAULT_BAN_HOURS, PERMANENT_BAN_HOURS } from "./decisions";

export const BAN_DURATIONS = [
  { hours: 1, labelKey: "firewall.duration.hour1" },
  { hours: 24, labelKey: "firewall.duration.hours24" },
  { hours: 168, labelKey: "firewall.duration.days7" },
  { hours: DEFAULT_BAN_HOURS, labelKey: "firewall.duration.days30" },
  { hours: 4320, labelKey: "firewall.duration.days180" },
  // CrowdSec counts every decision down, so "forever" is a hundred years —
  // see PERMANENT_BAN_HOURS. The row reads "permanent", not "36500d".
  { hours: PERMANENT_BAN_HOURS, labelKey: "firewall.duration.forever" },
] as const;
