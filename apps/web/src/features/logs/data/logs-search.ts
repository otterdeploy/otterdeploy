// URL-backed filter state for the project logs page. Keeping it in search params
// makes the current view shareable / reproducible (service, levels, text query,
// and the histogram time window all survive a reload or a copied link).

import * as z from "zod";

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
});

export type LogsSearch = z.infer<typeof zLogsSearch>;
