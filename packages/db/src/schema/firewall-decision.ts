import type { FirewallDecisionId } from "@otterdeploy/shared/id";

import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * A CrowdSec decision, recorded so it outlives its own TTL.
 *
 * CrowdSec's decisions are deliberately short-lived: a ban carries a duration
 * and the engine deletes it when that runs out. The Firewall view reads them
 * live from the LAPI, so an expired ban simply vanishes from the page — and
 * with it, any trace that the IP was ever a problem. An operator who looks an
 * hour after an SSH brute-force sees an empty table and no way to learn what
 * happened.
 *
 * This table is our own memory of what the engine has decided. A poller writes
 * a row the first time it sees a decision, keeps `lastSeenAt` fresh while it is
 * still live, and stamps `endedAt` when it disappears from the LAPI — which is
 * how "expired 20 minutes ago" becomes something the page can say.
 *
 * It is NOT the enforcement record. CrowdSec's own store is the only thing the
 * bouncers read; nothing here blocks anything. Deleting every row here would
 * cost history and change no traffic.
 */
export const firewallDecision = pgTable(
  "firewall_decision",
  {
    id: text("id")
      .primaryKey()
      .$type<FirewallDecisionId>()
      .$defaultFn(() => createId(ID_PREFIX.firewallDecision)),
    /** CrowdSec's own decision id. Null for rows recorded from a snapshot that
     *  didn't carry one (the `cscli` fallback path omits it). */
    lapiId: integer("lapi_id"),
    /** The banned IP or CIDR. */
    value: text("value").notNull(),
    /** `Ip` or `Range`, as CrowdSec spells it. */
    scope: text("scope").notNull(),
    /** `ban`, `captcha`, … */
    type: text("type").notNull(),
    /** What triggered it: `crowdsecurity/ssh-slow-bf`, a blocklist name, or a
     *  manual reason. The single most useful column when reading history. */
    scenario: text("scenario").notNull(),
    /** `crowdsec` (a local scenario), `CAPI` (community), `lists`, `cscli`. */
    origin: text("origin").notNull(),
    /** As CrowdSec reported it (`30m`, `4h`). Kept verbatim rather than parsed:
     *  it is what the operator saw, and the engine's spelling can change. */
    duration: text("duration"),
    country: text("country"),
    asNumber: text("as_number"),
    asName: text("as_name"),
    /** Events behind the decision, when the alert lookup supplied it. */
    eventsCount: integer("events_count"),
    /** First poll that saw this decision. */
    firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
    /** Most recent poll that still saw it. While a decision is live this keeps
     *  moving; once it ends it is the last moment we know it was enforced. */
    lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
    /** When the poll first failed to find it. NULL = still live. This is the
     *  column the UI's active/expired split reads. */
    endedAt: timestamp("ended_at"),
  },
  (table) => [
    // The natural key for a decision the LAPI numbered. Partial, because the
    // `cscli` fallback yields rows with no id and several of those can
    // legitimately coexist.
    uniqueIndex("firewall_decision_lapi_id_unique")
      .on(table.lapiId)
      .where(sql`lapi_id is not null`),
    // "Is this IP known to us?" — the lookup behind a value's history.
    index("firewall_decision_value_idx").on(table.value),
    // The default read: live decisions first, then most recently ended.
    index("firewall_decision_ended_at_idx").on(table.endedAt, table.lastSeenAt),
  ],
);
