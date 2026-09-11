/**
 * Caddy events, shaped like the ones the parser actually emits.
 *
 * Drawn from real logger names, categories and message text rather than
 * lorem, because the point of the preview is to see whether a 120px Category
 * column and a truncating Message column survive CONTENTS — and invented
 * strings are uniformly short in a way real ones never are.
 */

import type { EdgeEventRow } from "@/features/edge-logs/table/events-columns";

import { seededRandom, weightedPick } from "@/preview/fixtures/random";

interface Template {
  level: EdgeEventRow["level"];
  category: EdgeEventRow["category"];
  logger: string;
  msg: string;
  error?: string;
  upstream?: string;
  /** Relative weight — errors are rare, and a preview that shows them at 25% lies. */
  weight: number;
}

const TEMPLATES: Template[] = [
  {
    level: "info",
    category: "cert",
    logger: "tls.obtain",
    msg: "certificate obtained successfully",
    weight: 14,
  },
  {
    level: "info",
    category: "cert",
    logger: "tls.cache.maintenance",
    msg: "certificate expires soon; renewing",
    weight: 8,
  },
  {
    level: "warn",
    category: "cert",
    logger: "tls.issuance.acme",
    msg: "HTTP challenge failed; trying TLS-ALPN",
    error: "acme: authorization error: 403 urn:ietf:params:acme:error:unauthorized",
    weight: 4,
  },
  {
    level: "error",
    category: "cert",
    logger: "tls.issuance.acme.acme_client",
    msg: "could not get certificate from issuer",
    error: "too many failed authorizations recently: see https://letsencrypt.org/docs/rate-limits/",
    weight: 2,
  },
  {
    level: "info",
    category: "upstream",
    logger: "reverse_proxy.health_checker",
    msg: "upstream is now healthy",
    upstream: "10.0.3.14:3000",
    weight: 12,
  },
  {
    level: "warn",
    category: "upstream",
    logger: "reverse_proxy.health_checker",
    msg: "upstream failed health check",
    error: "dial tcp 10.0.3.14:3000: connect: connection refused",
    upstream: "10.0.3.14:3000",
    weight: 6,
  },
  {
    level: "error",
    category: "upstream",
    logger: "reverse_proxy",
    msg: "aborting with incomplete response",
    error: "context canceled",
    upstream: "10.0.3.22:8080",
    weight: 3,
  },
  {
    level: "info",
    category: "config",
    logger: "admin.api",
    msg: "load complete",
    weight: 9,
  },
  {
    level: "info",
    category: "config",
    logger: "http",
    msg: "server running; enabling automatic HTTPS",
    weight: 5,
  },
  {
    level: "debug",
    category: "other",
    logger: "http.handlers.rewrite",
    msg: "rewrote request",
    weight: 7,
  },
  {
    level: "debug",
    category: "other",
    logger: "http.log.access",
    msg: "handled request",
    weight: 10,
  },
];

/**
 * The org's own domains. No `null` among them.
 *
 * A row the caller owns no host on cannot reach this table at all — that IS
 * the feed's tenant scope — so a fixture producing one would be judging a cell
 * state the column can never be in. What DOES happen, and is modelled below,
 * is a row with no `host` of its own: a certificate batch carries its names in
 * `domains` instead.
 */
const HOSTS = [
  "otterdeploy.com",
  "app.otterdeploy.com",
  "api.otterdeploy.com",
  "store.dealort.com",
  "staging.otterdeploy.com",
];

/**
 * Where the bursts sit, as a fraction of the window back from now.
 *
 * Uneven on purpose: evenly spaced centres draw a regular comb, and a comb is
 * as unrepresentative of a real feed as a flat line.
 */
const BURST_CENTRES = [0.015, 0.06, 0.14, 0.21, 0.34, 0.42, 0.58, 0.67, 0.79, 0.93];

/**
 * How far back one row landed, as a fraction of the window.
 *
 * The jitter is MULTIPLICATIVE. An additive one plus a floor — which is what
 * this was — cannot push a burst near `now` past zero, so it piled every
 * overshoot onto the floor instead: sixteen rows shared one second, and the
 * first page read as a single instant. Which is the one thing the clock column
 * in this preview exists to disprove.
 *
 * Re-picking the centre on each attempt is what keeps the retry from becoming
 * a pile of its own: only the oldest centre can overshoot the far end, so
 * eight consecutive misses is not a case that happens.
 */
function arrivalOffset(random: () => number): number {
  for (let attempt = 0; attempt < 8; attempt++) {
    const centre = BURST_CENTRES[Math.floor(random() * BURST_CENTRES.length)] ?? 0.5;
    const offset = centre * (0.7 + random() * 0.6);
    if (offset > 0.002 && offset < 0.985) return offset;
  }
  return 0.5;
}

/**
 * The other names a certificate batch covered.
 *
 * A real renewal sweep does several domains at once, and a fixture where every
 * batch is exactly one name never renders the `+N` the cell exists for.
 */
function batchOf(host: string, random: () => number): string[] {
  const extra = HOSTS.filter((candidate) => candidate !== host);
  const count = Math.floor(random() * 3);
  return [host, ...extra.slice(0, count)];
}

/**
 * Events over the last `hours`, bunched rather than evenly spaced.
 *
 * Real edge events arrive in bursts — a config reload, a renewal sweep, an
 * upstream flapping — and an evenly-spaced fixture draws a flat histogram,
 * which is exactly the shape that hides whether the histogram is any use.
 */
export function edgeEventFixtures(count = 420, hours = 24, seed = 7): EdgeEventRow[] {
  const random = seededRandom(seed);
  const now = Date.now();
  const spanMs = hours * 3_600_000;
  const rows: EdgeEventRow[] = [];

  for (let index = 0; index < count; index++) {
    const at = now - arrivalOffset(random) * spanMs;

    const template = weightedPick(TEMPLATES, random);
    const name = HOSTS[Math.floor(random() * HOSTS.length)] ?? "otterdeploy.com";
    // Certificate work is batched across the names it covers and carries no
    // host of its own, which is exactly why the feed's host key is the UNION
    // of `host` and `domains`. Everything else is attributed to one host.
    const batched = template.category === "cert";
    const host = batched ? null : name;
    const domains = batched ? batchOf(name, random) : [];
    rows.push({
      id: `evt_${index.toString().padStart(4, "0")}`,
      // Epoch millis, as the feed sends it: `ts` is the cursor, the histogram's
      // bucket key and the sort key, and every one of those wants a number.
      ts: Math.round(at),
      level: template.level,
      category: template.category,
      logger: template.logger,
      msg: template.msg,
      host,
      domains,
      // The union the feed computes server-side, deduped: a batch usually names
      // the row's own host as well.
      hosts: [...new Set([...(host ? [host] : []), ...domains])],
      upstream: template.upstream ?? null,
      error: template.error ?? null,
      raw: JSON.stringify(
        {
          level: template.level,
          ts: at / 1000,
          logger: template.logger,
          msg: template.msg,
          ...(host ? { identifier: host } : {}),
          ...(template.upstream ? { upstream: template.upstream } : {}),
          ...(template.error ? { error: template.error } : {}),
        },
        null,
        2,
      ),
    });
  }
  return rows;
}
