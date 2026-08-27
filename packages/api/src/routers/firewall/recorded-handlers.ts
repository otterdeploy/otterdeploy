/**
 * The two reads that answer "what happened", split from index.ts on the file
 * cap — and they belong together: one serves our recorded history, the other
 * fetches the CrowdSec alerts behind a single row of it.
 */
import { requireInstallAdmin } from "../..";
import { RANGE_MS as WINDOW_MS } from "../../edge-logs/ring";
import { fetchAlertsForValue } from "./alerts-read";
import { listRecordedDecisions } from "./queries";

const globalFirewallRead = requireInstallAdmin();

export const recordedHandlers = {
  history: globalFirewallRead.firewall.history.handler(async ({ input }) => {
    const since = input.window === "all" ? null : new Date(Date.now() - WINDOW_MS[input.window]);
    const rows = await listRecordedDecisions({ since, state: input.state, limit: 200 });
    return rows.map((row) => ({
      ...row,
      firstSeenAt: row.firstSeenAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
      endedAt: row.endedAt?.toISOString() ?? null,
    }));
  }),

  alerts: globalFirewallRead.firewall.alerts.handler(async ({ input }) => {
    const alerts = await fetchAlertsForValue(input.value);
    // `available: false` is not an error: the row is still worth showing, we
    // just can't say WHY right now (agent down, or LAPI unconfigured).
    return { available: alerts !== null, alerts: alerts ?? [] };
  }),
};
