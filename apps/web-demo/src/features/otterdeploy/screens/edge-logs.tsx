// Edge access logs — Caddy edge proxy access log viewer.
// Distinct from app logs: every line is a single HTTP request hitting the public proxy.

import { useEffect, useMemo, useRef, useState } from "react";

import { rid, rint, ts } from "../data";
import { I } from "../icons";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type StatusBucket = "2xx" | "3xx" | "4xx" | "5xx";
type TimeRange = "5m" | "1h" | "6h" | "24h" | "7d";

const METHODS: Method[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const STATUS_BUCKETS: StatusBucket[] = ["2xx", "3xx", "4xx", "5xx"];
const TIME_RANGES: TimeRange[] = ["5m", "1h", "6h", "24h", "7d"];
const HOSTS = ["helio.so", "api.helio.so", "img.helio.so", "staging.helio.so"] as const;

const METHOD_TONE: Record<Method, string> = {
  GET: "var(--info)",
  POST: "var(--ok)",
  PUT: "var(--warn)",
  PATCH: "var(--warn)",
  DELETE: "var(--err)",
};

const STATUS_TONE: Record<StatusBucket, string> = {
  "2xx": "var(--ok)",
  "3xx": "var(--info)",
  "4xx": "var(--warn)",
  "5xx": "var(--err)",
};

interface LogLine {
  id: string;
  ts: string;
  method: Method;
  host: string;
  path: string;
  status: number;
  latencyMs: number;
  ip: string;
  ua: string;
  uaShort: string;
  country: string;
  flag: string;
  referer: string;
  reqId: string;
  tlsCipher: string;
  tlsVersion: string;
  upstream: string;
  upstreamLatency: number;
  reqBytes: number;
  resBytes: number;
  cache: "HIT" | "MISS" | "BYPASS";
}

const PATHS_BY_HOST: Record<string, string[]> = {
  "helio.so": [
    "/",
    "/pricing",
    "/blog/why-helio",
    "/login",
    "/signup",
    "/_next/static/chunks/main.js",
    "/og.png",
  ],
  "api.helio.so": [
    "/v1/charges",
    "/v1/users/me",
    "/healthz",
    "/v1/teams",
    "/v1/webhooks/stripe",
    "/v1/projects",
  ],
  "img.helio.so": [
    "/resize:fit:800/blog/cover.jpg",
    "/resize:fit:200/avatars/u-mira.png",
    "/optimize/og.png",
  ],
  "staging.helio.so": ["/", "/admin", "/healthz", "/api/preview"],
};

const UA_POOL: Array<{ short: string; full: string }> = [
  {
    short: "Chrome 130 / macOS",
    full: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  },
  {
    short: "Safari 18 / iOS",
    full: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  },
  {
    short: "Firefox 131 / Linux",
    full: "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
  },
  { short: "curl/8.7", full: "curl/8.7.1" },
  {
    short: "GoogleBot",
    full: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  },
  { short: "stripe-webhook", full: "Stripe/1.0 (+https://stripe.com/docs/webhooks)" },
  { short: "node-fetch/3", full: "node-fetch/3.3.2 (+https://github.com/node-fetch/node-fetch)" },
];

const COUNTRIES: Array<{ flag: string; code: string }> = [
  { flag: "🇺🇸", code: "US" },
  { flag: "🇬🇧", code: "GB" },
  { flag: "🇩🇪", code: "DE" },
  { flag: "🇯🇵", code: "JP" },
  { flag: "🇧🇷", code: "BR" },
  { flag: "🇮🇳", code: "IN" },
  { flag: "🇫🇷", code: "FR" },
  { flag: "🇨🇦", code: "CA" },
  { flag: "🇸🇬", code: "SG" },
  { flag: "🇦🇺", code: "AU" },
];

const UPSTREAMS = [
  "web.r1",
  "web.r2",
  "web.r3",
  "api.r1",
  "api.r2",
  "api.r3",
  "api.r4",
  "imgproxy.r1",
];

function pickStatus(): number {
  const r = Math.random();
  if (r < 0.78) return [200, 200, 200, 201, 204][rint(0, 5)]!;
  if (r < 0.88) return [301, 302, 304][rint(0, 3)]!;
  if (r < 0.97) return [400, 401, 403, 404, 404, 422, 429][rint(0, 7)]!;
  return [500, 502, 503, 504][rint(0, 4)]!;
}

function statusBucket(s: number): StatusBucket {
  if (s < 300) return "2xx";
  if (s < 400) return "3xx";
  if (s < 500) return "4xx";
  return "5xx";
}

function ipv4(): string {
  return `${rint(8, 240)}.${rint(0, 255)}.${rint(0, 255)}.${rint(1, 254)}`;
}

function genLine(): LogLine {
  const method: Method = (() => {
    const r = Math.random();
    if (r < 0.7) return "GET";
    if (r < 0.85) return "POST";
    if (r < 0.92) return "PUT";
    if (r < 0.97) return "PATCH";
    return "DELETE";
  })();
  const host = HOSTS[rint(0, HOSTS.length)]!;
  const paths = PATHS_BY_HOST[host]!;
  const path = paths[rint(0, paths.length)]!;
  const status = pickStatus();
  const ua = UA_POOL[rint(0, UA_POOL.length)]!;
  const country = COUNTRIES[rint(0, COUNTRIES.length)]!;
  const latency = status >= 500 ? rint(800, 4500) : status >= 400 ? rint(20, 220) : rint(8, 320);
  const upstream = UPSTREAMS[rint(0, UPSTREAMS.length)]!;
  return {
    id: rid() + rid(),
    ts: ts(),
    method,
    host,
    path,
    status,
    latencyMs: latency,
    ip: ipv4(),
    ua: ua.full,
    uaShort: ua.short,
    country: country.code,
    flag: country.flag,
    referer: Math.random() < 0.4 ? "-" : `https://${HOSTS[rint(0, HOSTS.length)]}${path}`,
    reqId: `req_${rid()}${rid()}`,
    tlsCipher: ["TLS_AES_128_GCM_SHA256", "TLS_AES_256_GCM_SHA384", "TLS_CHACHA20_POLY1305_SHA256"][
      rint(0, 3)
    ]!,
    tlsVersion: Math.random() < 0.92 ? "TLSv1.3" : "TLSv1.2",
    upstream,
    upstreamLatency: Math.max(2, latency - rint(2, 18)),
    reqBytes: rint(180, 2400),
    resBytes: status >= 400 ? rint(120, 800) : rint(800, 184000),
    cache:
      method === "GET" && Math.random() < 0.35 ? "HIT" : Math.random() < 0.05 ? "BYPASS" : "MISS",
  };
}

export function EdgeLogs() {
  const [range, setRange] = useState<TimeRange>("1h");
  const [methodFilter, setMethodFilter] = useState<Set<Method>>(new Set(METHODS));
  const [statusFilter, setStatusFilter] = useState<Set<StatusBucket>>(new Set(STATUS_BUCKETS));
  const [hostFilter, setHostFilter] = useState<string>("all");
  const [q, setQ] = useState("");
  const [paused, setPaused] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [lines, setLines] = useState<LogLine[]>(() => Array.from({ length: 80 }, () => genLine()));
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (paused) return;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      setLines((prev) => [genLine(), ...prev.slice(0, 399)]);
      setTimeout(tick, 400 + Math.random() * 800);
    };
    const handle = setTimeout(tick, 600);
    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [paused]);

  const filtered = lines.filter(
    (l) =>
      methodFilter.has(l.method) &&
      statusFilter.has(statusBucket(l.status)) &&
      (hostFilter === "all" || l.host === hostFilter) &&
      (!q ||
        l.path.toLowerCase().includes(q.toLowerCase()) ||
        l.ip.includes(q) ||
        l.host.includes(q.toLowerCase()) ||
        String(l.status).startsWith(q)),
  );

  const histo = useMemo(() => {
    const buckets = Array.from(
      { length: 60 },
      () => ({ "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 }) as Record<StatusBucket, number>,
    );
    let s = 7;
    const rng = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    for (let i = 0; i < buckets.length; i++) {
      buckets[i]!["2xx"] = Math.round(rng() * 80 + 20);
      buckets[i]!["3xx"] = Math.round(rng() * 14);
      buckets[i]!["4xx"] = Math.round(rng() * 9);
      buckets[i]!["5xx"] = Math.round(rng() * 2);
    }
    buckets[buckets.length - 8]!["5xx"] = 14;
    buckets[buckets.length - 8]!["4xx"] = 28;
    return buckets;
  }, [range]);
  const maxH = Math.max(...histo.map((b) => b["2xx"] + b["3xx"] + b["4xx"] + b["5xx"]));

  const perHost = useMemo(() => {
    const acc: Record<string, { n: number; err: number; lat: number[] }> = {};
    for (const h of HOSTS) acc[h] = { n: 0, err: 0, lat: [] };
    for (const l of lines) {
      const a = acc[l.host];
      if (!a) continue;
      a.n++;
      if (l.status >= 400) a.err++;
      a.lat.push(l.latencyMs);
    }
    return HOSTS.map((h) => {
      const a = acc[h]!;
      const sorted = [...a.lat].sort((x, y) => x - y);
      const pick = (p: number) =>
        sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
      return {
        host: h,
        rps: +(a.n / 60).toFixed(2),
        errRate: a.n === 0 ? 0 : +((a.err / a.n) * 100).toFixed(1),
        p50: pick(0.5),
        p95: pick(0.95),
        p99: pick(0.99),
      };
    });
  }, [lines]);

  const exportCsv = () => {
    const rows = filtered.map((l) =>
      [l.ts, l.method, l.status, l.host, l.path, l.latencyMs + "ms", l.ip, l.country].join(","),
    );
    // eslint-disable-next-line no-console
    console.log("[edge-logs] export", rows.length, "rows");
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "16px 20px 10px", borderBottom: "1px solid var(--border)" }}>
        <div className="row gap-2" style={{ alignItems: "baseline" }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Edge access logs</h2>
          <span className="badge live ok">
            <span className="dot" />
            {paused ? "paused" : "live tail"}
          </span>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          Every HTTP request that hit the Caddy edge proxy. Live tailing from Caddy&apos;s
          structured access log.
        </div>
      </div>

      {/* Toolbar */}
      <div
        className="row gap-2"
        style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}
      >
        <div
          className="row gap-1"
          style={{
            background: "var(--bg-sunken)",
            padding: 2,
            borderRadius: 6,
            border: "1px solid var(--border)",
          }}
        >
          {TIME_RANGES.map((r) => {
            const on = range === r;
            return (
              <button
                key={r}
                onClick={() => setRange(r)}
                className="mono"
                style={{
                  padding: "3px 8px",
                  fontSize: 11,
                  borderRadius: 4,
                  background: on ? "var(--bg-elev)" : "transparent",
                  color: on ? "var(--fg)" : "var(--fg-3)",
                  fontWeight: on ? 500 : 400,
                  cursor: "pointer",
                  boxShadow: on ? "var(--shadow-sm)" : "none",
                  border: 0,
                }}
              >
                {r}
              </button>
            );
          })}
        </div>

        <div
          className="row gap-1"
          style={{
            background: "var(--bg-sunken)",
            padding: 2,
            borderRadius: 6,
            border: "1px solid var(--border)",
          }}
        >
          {METHODS.map((m) => {
            const on = methodFilter.has(m);
            return (
              <button
                key={m}
                onClick={() =>
                  setMethodFilter((s) => {
                    const n = new Set(s);
                    if (n.has(m)) n.delete(m);
                    else n.add(m);
                    return n;
                  })
                }
                className="mono"
                style={{
                  padding: "3px 6px",
                  fontSize: 10,
                  borderRadius: 4,
                  background: on ? "var(--bg-elev)" : "transparent",
                  color: on ? METHOD_TONE[m] : "var(--fg-4)",
                  fontWeight: on ? 600 : 400,
                  cursor: "pointer",
                  boxShadow: on ? "var(--shadow-sm)" : "none",
                  border: 0,
                  letterSpacing: "0.04em",
                }}
              >
                {m}
              </button>
            );
          })}
        </div>

        <div
          className="row gap-1"
          style={{
            background: "var(--bg-sunken)",
            padding: 2,
            borderRadius: 6,
            border: "1px solid var(--border)",
          }}
        >
          {STATUS_BUCKETS.map((b) => {
            const on = statusFilter.has(b);
            return (
              <button
                key={b}
                onClick={() =>
                  setStatusFilter((s) => {
                    const n = new Set(s);
                    if (n.has(b)) n.delete(b);
                    else n.add(b);
                    return n;
                  })
                }
                className="mono"
                style={{
                  padding: "3px 6px",
                  fontSize: 10,
                  borderRadius: 4,
                  background: on ? "var(--bg-elev)" : "transparent",
                  color: on ? STATUS_TONE[b] : "var(--fg-4)",
                  fontWeight: on ? 600 : 400,
                  cursor: "pointer",
                  boxShadow: on ? "var(--shadow-sm)" : "none",
                  border: 0,
                }}
              >
                {b}
              </button>
            );
          })}
        </div>

        <select
          className="input"
          value={hostFilter}
          onChange={(e) => setHostFilter(e.target.value)}
          style={{ width: 170, height: 28 }}
        >
          <option value="all">All hosts</option>
          {HOSTS.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>

        <input
          className="input mono"
          placeholder="search path, ip, status…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1, minWidth: 200, maxWidth: 320 }}
        />

        <div style={{ flex: 1 }} />
        <button className="btn sm" onClick={() => setPaused((p) => !p)}>
          {paused ? "Resume" : "Pause"}
        </button>
        <button className="btn sm" onClick={exportCsv}>
          <I.download width={11} height={11} /> Export
        </button>
      </div>

      {/* Volume histogram */}
      <div style={{ padding: "12px 18px 8px", borderBottom: "1px solid var(--border)" }}>
        <div className="row" style={{ marginBottom: 6, fontSize: 11 }}>
          <span className="muted" style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Volume
          </span>
          <div style={{ flex: 1 }} />
          <span className="mono muted">
            {lines.length} loaded · {filtered.length} match
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 1, height: 52 }}>
          {histo.map((b, i) => {
            const total = b["2xx"] + b["3xx"] + b["4xx"] + b["5xx"];
            const h = (total / maxH) * 52;
            return (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: h,
                  display: "flex",
                  flexDirection: "column-reverse",
                  minHeight: 1,
                }}
                title={`${total} requests`}
              >
                <div style={{ height: `${(b["2xx"] / total) * 100}%`, background: "var(--ok)" }} />
                <div
                  style={{ height: `${(b["3xx"] / total) * 100}%`, background: "var(--info)" }}
                />
                <div
                  style={{ height: `${(b["4xx"] / total) * 100}%`, background: "var(--warn)" }}
                />
                <div style={{ height: `${(b["5xx"] / total) * 100}%`, background: "var(--err)" }} />
              </div>
            );
          })}
        </div>
        <div className="row" style={{ marginTop: 4, fontSize: 10, color: "var(--fg-4)" }}>
          <span className="mono">−{range}</span>
          <div style={{ flex: 1 }} />
          <span className="mono">now</span>
        </div>
      </div>

      {/* Column header */}
      <div
        className="row"
        style={{
          padding: "6px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: 10,
          color: "var(--fg-3)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          background: "var(--bg-sunken)",
        }}
      >
        <span style={{ width: 12 }} />
        <span style={{ width: 96 }}>Time</span>
        <span style={{ width: 60 }}>Method</span>
        <span style={{ width: 50 }}>Status</span>
        <span style={{ width: 130 }}>Host</span>
        <span style={{ flex: 1, minWidth: 200 }}>Path</span>
        <span style={{ width: 80 }}>Latency</span>
        <span style={{ width: 110 }}>Client IP</span>
        <span style={{ width: 30, textAlign: "center" }}>Loc</span>
        <span style={{ width: 160 }}>User-agent</span>
      </div>

      {/* Rows */}
      <div
        ref={scrollRef}
        className="os-scroll"
        style={{ flex: 1, overflow: "auto", background: "var(--bg)" }}
      >
        {filtered.map((l) => (
          <EdgeRow
            key={l.id}
            l={l}
            expanded={!!expanded[l.id]}
            onToggle={() => setExpanded((e) => ({ ...e, [l.id]: !e[l.id] }))}
          />
        ))}
        {filtered.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: "var(--fg-3)", fontSize: 13 }}>
            No requests match these filters.
          </div>
        )}
      </div>

      {/* Per-host summary */}
      <div
        style={{
          borderTop: "1px solid var(--border)",
          background: "var(--bg-sunken)",
          padding: "8px 16px",
          display: "flex",
          gap: 16,
          overflowX: "auto",
        }}
      >
        {perHost.map((p) => (
          <div key={p.host} className="row gap-3" style={{ flex: "0 0 auto" }}>
            <div>
              <div className="mono" style={{ fontSize: 11, color: "var(--fg-2)" }}>
                {p.host}
              </div>
              <div className="row gap-3" style={{ fontSize: 10, marginTop: 2 }}>
                <span className="mono muted">{p.rps} rps</span>
                <span
                  className="mono"
                  style={{
                    color:
                      p.errRate >= 2
                        ? "var(--err)"
                        : p.errRate >= 0.5
                          ? "var(--warn)"
                          : "var(--fg-3)",
                  }}
                >
                  {p.errRate}% err
                </span>
                <span className="mono muted">p50 {p.p50}ms</span>
                <span className="mono muted">p95 {p.p95}ms</span>
                <span className="mono muted">p99 {p.p99}ms</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EdgeRow({
  l,
  expanded,
  onToggle,
}: {
  l: LogLine;
  expanded: boolean;
  onToggle: () => void;
}) {
  const sb = statusBucket(l.status);
  const latPct = Math.min(100, (l.latencyMs / 1000) * 100);
  return (
    <div
      style={{
        borderBottom: "1px solid var(--border)",
        background: expanded ? "var(--bg-overlay)" : "transparent",
        cursor: "pointer",
      }}
      onClick={onToggle}
    >
      <div
        className="row mono"
        style={{
          alignItems: "center",
          padding: "5px 16px",
          fontSize: 11.5,
          lineHeight: 1.4,
        }}
      >
        <span style={{ width: 12, color: "var(--fg-4)" }}>
          <I.chev width={9} height={9} style={{ transform: expanded ? "rotate(90deg)" : "none" }} />
        </span>
        <span style={{ width: 96, color: "var(--fg-3)" }}>{l.ts}</span>
        <span style={{ width: 60 }}>
          <span
            className="mono"
            style={{
              padding: "1px 5px",
              borderRadius: 3,
              fontSize: 10,
              fontWeight: 600,
              color: METHOD_TONE[l.method],
              background: `color-mix(in srgb, ${METHOD_TONE[l.method]} 12%, transparent)`,
              border: `1px solid color-mix(in srgb, ${METHOD_TONE[l.method]} 28%, transparent)`,
            }}
          >
            {l.method}
          </span>
        </span>
        <span
          style={{
            width: 50,
            color: STATUS_TONE[sb],
            fontWeight: 600,
          }}
        >
          {l.status}
        </span>
        <span
          style={{
            width: 130,
            color: "var(--fg-2)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {l.host}
        </span>
        <span
          style={{
            flex: 1,
            minWidth: 200,
            color: "var(--fg)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            paddingRight: 8,
          }}
        >
          {l.path}
        </span>
        <span style={{ width: 80 }}>
          <div className="row gap-1" style={{ alignItems: "center" }}>
            <span style={{ color: "var(--fg-2)" }}>{l.latencyMs}ms</span>
            <span
              style={{
                width: 22,
                height: 4,
                borderRadius: 2,
                background: "var(--bg-overlay)",
                overflow: "hidden",
              }}
            >
              <span
                style={{
                  display: "block",
                  height: "100%",
                  width: `${latPct}%`,
                  background:
                    l.latencyMs > 800
                      ? "var(--err)"
                      : l.latencyMs > 300
                        ? "var(--warn)"
                        : "var(--fg-4)",
                }}
              />
            </span>
          </div>
        </span>
        <span style={{ width: 110, color: "var(--fg-3)" }}>{l.ip}</span>
        <span style={{ width: 30, textAlign: "center", fontSize: 13 }} title={l.country}>
          {l.flag}
        </span>
        <span
          style={{
            width: 160,
            color: "var(--fg-3)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: 10.5,
          }}
          title={l.ua}
        >
          {l.uaShort}
        </span>
      </div>

      {expanded && (
        <div
          style={{
            padding: "10px 16px 14px 28px",
            background: "var(--bg-sunken)",
            borderTop: "1px solid var(--border)",
            fontSize: 11,
            color: "var(--fg-2)",
            lineHeight: 1.7,
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 24px" }}>
            <div>
              <span style={{ color: "var(--fg-3)" }}>request_id </span>
              <span className="mono">{l.reqId}</span>
            </div>
            <div>
              <span style={{ color: "var(--fg-3)" }}>cache </span>
              <span
                className="mono"
                style={{
                  color:
                    l.cache === "HIT"
                      ? "var(--ok)"
                      : l.cache === "BYPASS"
                        ? "var(--warn)"
                        : "var(--fg-2)",
                }}
              >
                {l.cache}
              </span>
            </div>
            <div>
              <span style={{ color: "var(--fg-3)" }}>upstream </span>
              <span className="mono">{l.upstream}</span>{" "}
              <span className="muted">({l.upstreamLatency}ms)</span>
            </div>
            <div>
              <span style={{ color: "var(--fg-3)" }}>tls </span>
              <span className="mono">
                {l.tlsVersion} · {l.tlsCipher}
              </span>
            </div>
            <div>
              <span style={{ color: "var(--fg-3)" }}>req bytes </span>
              <span className="mono">{l.reqBytes}</span>
            </div>
            <div>
              <span style={{ color: "var(--fg-3)" }}>res bytes </span>
              <span className="mono">{l.resBytes.toLocaleString()}</span>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <span style={{ color: "var(--fg-3)" }}>referer </span>
              <span className="mono" style={{ wordBreak: "break-all" }}>
                {l.referer}
              </span>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <span style={{ color: "var(--fg-3)" }}>user-agent </span>
              <span className="mono" style={{ wordBreak: "break-all" }}>
                {l.ua}
              </span>
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <div
              className="muted"
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom: 4,
              }}
            >
              Headers preview
            </div>
            <pre
              className="mono"
              style={{
                margin: 0,
                padding: 8,
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                fontSize: 10.5,
                lineHeight: 1.6,
                color: "var(--fg-3)",
                overflow: "auto",
              }}
            >{`accept: text/html,application/xhtml+xml,application/xml;q=0.9
accept-encoding: gzip, br
accept-language: en-US,en;q=0.5
host: ${l.host}
x-forwarded-for: ${l.ip}
x-forwarded-proto: https
x-request-id: ${l.reqId}`}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
