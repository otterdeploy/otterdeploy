/**
 * Edge access-log requests, shaped like a small app's real traffic.
 *
 * The mix matters more than the volume: mostly 2xx GETs, a steady trickle of
 * 4xx from scanners hitting paths that do not exist, a handful of 5xx clustered
 * rather than sprinkled (real failure arrives in bursts), and a long tail of
 * slow requests — because a latency column with no outliers cannot be judged.
 */

import type { EdgeAccessRow } from "@/features/edge-logs/table/access-columns";

import { statusBucket } from "@/features/edge-logs/table/access-cells";
import { classifyThreat } from "@/features/edge-logs/threat";
import { AGENTS, CLIENTS, ROUTES } from "@/preview/fixtures/edge-access-routes";
import { seededRandom, weightedPick } from "@/preview/fixtures/random";

export function edgeAccessFixtures(count = 900, hours = 6, seed = 11): EdgeAccessRow[] {
  const random = seededRandom(seed);
  const now = Date.now();
  const spanMs = hours * 3_600_000;
  const rows: EdgeAccessRow[] = [];

  for (let index = 0; index < count; index++) {
    // Traffic is continuous but not uniform: a squared roll leans recent, which
    // is what a live tail actually looks like.
    //
    // No floor. Clamping the low end is what makes the first page unreadable:
    // `random() ** 1.6` puts a real share of 900 rows under 0.002, and every
    // one of them lands on the clamp — eight rows reading `20:34:40` in a
    // column whose whole job is telling them apart. The curve already keeps
    // rows off zero often enough to look live.
    const at = now - random() ** 1.6 * spanMs;
    const route = weightedPick(ROUTES, random);
    const client = CLIENTS[Math.floor(random() * CLIENTS.length)];

    // Lognormal-ish: most requests near the typical, a few far above it. A
    // latency column whose values all sit at the mean proves nothing.
    const spread = 0.55 + random() * 0.9;
    const tail = random() > 0.96 ? 3 + random() * 5 : 1;
    const latencyMs = Math.max(1, Math.round(route.latency * spread * tail));

    rows.push({
      id: `req_${index.toString().padStart(4, "0")}`,
      // Epoch millis, as the feed sends it: `ts` is the cursor, the histogram's
      // bucket key and the sort key, and every one of those wants a number.
      ts: Math.round(at),
      method: route.method,
      host: route.host,
      path: route.path,
      status: route.status,
      // Both DERIVED keys, materialised the way the feed's SQL expressions put
      // them on the row — see `routers/edge-logs/access-table.ts`.
      statusClass: statusBucket(route.status),
      latencyMs,
      clientIp: client.ip,
      country: client.country,
      userAgent: AGENTS[Math.floor(random() * AGENTS.length)],
      referer: random() > 0.6 ? `https://${route.host}/` : "",
      tlsVersion: "TLS 1.3",
      tlsCipher: "TLS_AES_128_GCM_SHA256",
      upstream: route.upstream ?? null,
      cache: route.cache ?? null,
      reqBytes: 200 + Math.floor(random() * 900),
      resBytes:
        route.method === "GET" ? 400 + Math.floor(random() * 48_000) : Math.floor(random() * 2_400),
      requestId: `req_${Math.floor(random() * 1e12).toString(36)}`,
      suspicious: classifyThreat(route.path) === null ? "no" : "yes",
      headers: {
        "accept-encoding": "gzip, br",
        "x-forwarded-proto": "https",
        "x-forwarded-for": client.ip,
        host: route.host,
      },
    });
  }
  return rows;
}
