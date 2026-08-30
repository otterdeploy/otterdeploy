/**
 * The Firewall's tabs, after the merge.
 *
 * There were four: Enforcing Now, History, Flagged IPs and Sources. The first
 * two were the same question in two tenses and are now one tab with a tense
 * switch (see ./data BLOCKED_TENSES), which leaves three genuinely different
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

export function isFirewallTab(v: string): v is FirewallTab {
  return FIREWALL_TABS.some((t) => t === v);
}
