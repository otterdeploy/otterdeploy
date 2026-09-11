/**
 * The access table's URL keys, declared once for the two routes that host it.
 *
 * Edge → Access logs and the project Logs page's Edge source both render the
 * same table, and TanStack validates search PER ROUTE — so each has to declare
 * these keys itself. Writing them out twice is how one route quietly stops
 * accepting a filter the other still links to.
 *
 * `q` is deliberately absent: it is the table-wide search on this surface and
 * something else on the runtime-logs half of the project page, so each route
 * declares it once for both of its tabs.
 */

import { filterParam } from "@/shared/components/data-table/state/search-schema";

export const edgeAccessSearchParams = {
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
};
