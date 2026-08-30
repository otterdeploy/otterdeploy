/**
 * The Firewall's tabs, after the merge.
 *
 * There were four: Enforcing Now, History, Flagged IPs and Sources. The first
 * two were the same question in two tenses and are now one tab with a range
 * control (see ./data BLOCKED_RANGES), which leaves three genuinely different
 * things: what CrowdSec is rejecting, who is probing us and hasn't been
 * blocked yet, and where imported blocklists come from.
 */
export const FIREWALL_TABS = ["blocked", "flagged", "sources"] as const;
export type FirewallTab = (typeof FIREWALL_TABS)[number];

export const TAB_LABEL: Record<FirewallTab, string> = {
  blocked: "Blocked",
  flagged: "Flagged",
  sources: "Sources",
};
