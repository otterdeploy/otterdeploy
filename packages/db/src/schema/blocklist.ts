import type { BlocklistId } from "@otterdeploy/shared/id";

import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * A managed IP blocklist the platform periodically imports into the CrowdSec
 * agent (via `cscli decisions import`). Lets operators turn on well-known free
 * public lists (FireHOL, Spamhaus, Tor, …) or add their own list URL — no
 * CrowdSec account required. CrowdSec is cluster-wide / identity-blind, so these
 * apply globally; we keep them in one table (org admins manage them). The
 * imported decisions carry `--reason blocklist:<id>` so a sync can refresh or a
 * delete can clear exactly this list. See docs/designs/deployment-protection.md.
 */
export const blocklist = pgTable(
  "blocklist",
  {
    id: text("id")
      .primaryKey()
      .$type<BlocklistId>()
      .$defaultFn(() => createId(ID_PREFIX.blocklist)),
    /** Display name. */
    name: text("name").notNull(),
    /** Plain-text list URL (one IP/CIDR per line; `#`/`;` comments allowed). */
    url: text("url").notNull(),
    /** Catalog slug for a curated/built-in list; null for a user's custom URL. */
    catalogSlug: text("catalog_slug"),
    enabled: boolean("enabled").notNull().default(true),
    /** Ban duration applied to imported decisions, in hours. Re-synced before
     *  expiry by the recurring job. */
    durationHours: integer("duration_hours").notNull().default(24),
    /** Refresh cadence, in minutes. */
    intervalMinutes: integer("interval_minutes").notNull().default(360),
    /** Last sync bookkeeping. */
    lastSyncedAt: timestamp("last_synced_at"),
    lastStatus: text("last_status").$type<"ok" | "error" | "pending">(),
    lastError: text("last_error"),
    lastCount: integer("last_count"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex("blocklist_url_unique").on(t.url),
    index("blocklist_enabled_idx").on(t.enabled),
  ],
);
