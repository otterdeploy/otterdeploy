// URL-backed filter state for the project logs page. Keeping it in search params
// makes the current view shareable / reproducible (service, levels, text query,
// and the histogram time window all survive a reload or a copied link).

import * as z from "zod";

import { filterParam, tableSearchSchema } from "@/shared/components/data-table/state/search-schema";

const LOG_SOURCES = ["runtime", "edge"] as const;
export type LogsSource = (typeof LOG_SOURCES)[number];

export const zLogsSearch = z.object({
  /** Resource id of a single service, or undefined for all. */
  service: z.string().optional(),
  /** Enabled log levels; undefined means all (keeps the URL clean). */
  levels: z.array(z.enum(["debug", "info", "warn", "error"])).optional(),
  /** Free-text message filter. */
  q: z.string().optional(),
  /** Histogram time-window filter (epoch ms); both set or both absent. */
  from: z.number().optional(),
  to: z.number().optional(),
  /**
   * Runtime | Edge source toggle (od-u63.5, the project Edge logs tab
   * merged into Logs). `.catch` covers both a missing param and a bad value
   * → default to Runtime, so the page always has a valid controlled source.
   */
  source: z.enum(LOG_SOURCES).catch("runtime"),

  /**
   * The Edge source's table controls.
   *
   * They live here because the Edge access log is a TAB of this route, and
   * TanStack validates search per route. `q` is deliberately not re-declared:
   * both sources mean "free text over these log lines" by it, so carrying it
   * across the toggle is the behaviour someone switching sources expects. The
   * rest are the Edge table's alone, and the runtime side's `coerce` drops
   * them, so a stale one degrades to no filter rather than an error.
   *
   * Spread from `tableSearchSchema` rather than a catchall: a derived shape
   * erases its keys, and TanStack merges route search types, so one such route
   * would make `navigate` untyped everywhere else in the app.
   */
  ...tableSearchSchema({
    ts: filterParam.timerange(),
    method: filterParam.checkbox(),
    status: filterParam.checkbox(),
    statusClass: filterParam.checkbox(),
    host: filterParam.checkbox(),
    clientIp: filterParam.checkbox(),
    country: filterParam.checkbox(),
    upstream: filterParam.checkbox(),
    cache: filterParam.checkbox(),
    latencyMs: filterParam.range(),
    suspicious: filterParam.checkbox(),
  }).shape,
});

export type LogsSearch = z.infer<typeof zLogsSearch>;
