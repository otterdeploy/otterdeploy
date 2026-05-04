// Logs viewer (v2) — ported from /tmp/anth-design-qP3sS7/otterstack/project/screens2.jsx
// volume histogram + filter toolbar + log table + expand-to-details + wrap toggle.

import { useEffect, useMemo, useRef, useState } from "react";

import { I } from "../icons";
import { SERVICES, rid, rint, ts } from "../data";

const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
type LogLevel = (typeof LOG_LEVELS)[number];

const LOG_LEVEL_TONE: Record<LogLevel, string> = {
  debug: "var(--fg-4)",
  info: "var(--info)",
  warn: "var(--warn)",
  error: "var(--err)",
};

type LogSvc = "api" | "web" | "worker";
type LogLine = { ts: string; level: LogLevel; svc: string; msg: string; id: string };

function genLogLine(svc: string, force?: LogLevel): LogLine {
  const lv: LogLevel =
    force ||
    (Math.random() < 0.04
      ? "error"
      : Math.random() < 0.1
        ? "warn"
        : Math.random() < 0.15
          ? "debug"
          : "info");
  const samples: Record<LogSvc, Record<LogLevel, () => string>> = {
    api: {
      info: () => `GET /v1/users/${rid()} 200 ${rint(8, 42)}ms`,
      warn: () => `slow query 412ms SELECT * FROM events WHERE org_id=${rid()}`,
      error: () => `Error: ECONNRESET upstream postgres:5432 retries=2`,
      debug: () => `cache.hit user:${rid()} ttl=300`,
    },
    web: {
      info: () => `GET /pricing 200 ${rint(20, 80)}ms`,
      warn: () => `[next] page revalidation took 1.2s`,
      error: () => `TypeError: cannot read .props of undefined at /blog/[slug]`,
      debug: () => `[next] resolved /api/og in ${rint(20, 80)}ms`,
    },
    worker: {
      info: () => `task charge.processed#${rid()} done in ${rint(80, 600)}ms`,
      warn: () => `retrying webhook.deliver attempt 2/5`,
      error: () => `task email.send failed: SMTPConnectError`,
      debug: () => `heartbeat`,
    },
  };
  const set = samples[svc as LogSvc] || samples.api;
  return {
    ts: ts(),
    level: lv,
    svc,
    msg: set[lv](),
    id: Math.random().toString(36).slice(2, 9),
  };
}

export function Logs({ target }: { target?: string | null }) {
  const [svcFilter, setSvcFilter] = useState<string>(target ?? "all");
  const [lvlFilter, setLvlFilter] = useState<Set<LogLevel>>(new Set(LOG_LEVELS));
  const [q, setQ] = useState("");
  const [paused, setPaused] = useState(false);
  const [wrap, setWrap] = useState(true);
  const [lines, setLines] = useState<LogLine[]>(() => {
    const out: LogLine[] = [];
    const svcs: LogSvc[] = ["api", "web", "worker"];
    for (let i = 0; i < 60; i++) {
      out.push(genLogLine(svcs[Math.floor(Math.random() * svcs.length)]!));
    }
    return out;
  });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (paused) return;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const svcs: LogSvc[] = ["api", "web", "worker"];
      const ln = genLogLine(svcs[Math.floor(Math.random() * svcs.length)]!);
      setLines((p) => [...p.slice(-300), ln]);
      setTimeout(tick, 350 + Math.random() * 700);
    };
    const handle = setTimeout(tick, 400);
    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [paused]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [lines.length]);

  const filtered = lines.filter(
    (l) =>
      (svcFilter === "all" || l.svc === svcFilter) &&
      lvlFilter.has(l.level) &&
      (!q || l.msg.toLowerCase().includes(q.toLowerCase())),
  );

  const histo = useMemo(() => {
    const buckets = Array.from({ length: 28 }, () => ({ info: 0, warn: 0, error: 0, debug: 0 }));
    let s = 1;
    const rng = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    for (let i = 0; i < buckets.length; i++) {
      buckets[i]!.info = Math.round(rng() * 50 + 10);
      buckets[i]!.warn = Math.round(rng() * 8);
      buckets[i]!.error = Math.round(rng() * 3);
      buckets[i]!.debug = Math.round(rng() * 30);
    }
    buckets[buckets.length - 4]!.info = 240;
    buckets[buckets.length - 4]!.warn = 22;
    buckets[buckets.length - 4]!.error = 8;
    return buckets;
  }, []);
  const maxH = Math.max(...histo.map((b) => b.info + b.warn + b.error + b.debug));

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Volume histogram */}
      <div style={{ padding: "14px 18px 10px", borderBottom: "1px solid var(--border)" }}>
        <div className="row" style={{ marginBottom: 8, fontSize: 11 }}>
          <span className="muted" style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}>Volume</span>
          <div style={{ flex: 1 }} />
          <span className="mono muted">{lines.length} loaded · {filtered.length} match</span>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 56 }}>
          {histo.map((b, i) => {
            const total = b.info + b.warn + b.error + b.debug;
            const h = (total / maxH) * 56;
            return (
              <div
                key={i}
                style={{ flex: 1, height: h, display: "flex", flexDirection: "column-reverse", minHeight: 1 }}
                title={`${total} events`}
              >
                <div style={{ height: `${(b.info / total) * 100}%`, background: "var(--info)" }} />
                <div style={{ height: `${(b.debug / total) * 100}%`, background: "var(--fg-4)" }} />
                <div style={{ height: `${(b.warn / total) * 100}%`, background: "var(--warn)" }} />
                <div style={{ height: `${(b.error / total) * 100}%`, background: "var(--err)" }} />
              </div>
            );
          })}
        </div>
        <div className="row" style={{ marginTop: 4, fontSize: 10, color: "var(--fg-4)" }}>
          <span className="mono">−7d</span>
          <div style={{ flex: 1 }} />
          <span className="mono">now</span>
        </div>
      </div>

      {/* Filter toolbar */}
      <div
        className="row gap-2"
        style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}
      >
        <select
          className="input"
          style={{ width: 140, height: 28 }}
          value={svcFilter}
          onChange={(e) => setSvcFilter(e.target.value)}
        >
          <option value="all">All services</option>
          {SERVICES.filter((s) => s.kind === "service").map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <div
          className="row gap-1"
          style={{
            background: "var(--bg-sunken)",
            padding: 2,
            borderRadius: 6,
            border: "1px solid var(--border)",
          }}
        >
          {LOG_LEVELS.map((lv) => {
            const on = lvlFilter.has(lv);
            return (
              <button
                key={lv}
                onClick={() => {
                  setLvlFilter((s) => {
                    const n = new Set(s);
                    if (n.has(lv)) n.delete(lv);
                    else n.add(lv);
                    return n;
                  });
                }}
                style={{
                  padding: "3px 8px",
                  fontSize: 11,
                  borderRadius: 4,
                  background: on ? "var(--bg-elev)" : "transparent",
                  color: on ? LOG_LEVEL_TONE[lv] : "var(--fg-4)",
                  fontFamily: "var(--font-mono)",
                  cursor: "pointer",
                  fontWeight: on ? 500 : 400,
                  boxShadow: on ? "var(--shadow-sm)" : "none",
                  border: 0,
                }}
              >
                {lv}
              </button>
            );
          })}
        </div>
        <input
          className="input mono"
          placeholder="search messages, status:5xx, user:abc…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1, maxWidth: 380 }}
        />
        <span className="badge live ok"><span className="dot" />{paused ? "paused" : "live tail"}</span>
        <div style={{ flex: 1 }} />
        <button className="btn sm" onClick={() => setWrap((w) => !w)} style={{ opacity: wrap ? 1 : 0.6 }}>
          Wrap
        </button>
        <button className="btn sm" onClick={() => setPaused((p) => !p)}>
          {paused ? "Resume" : "Pause"}
        </button>
        <button className="btn ghost icon sm"><I.copy width={12} height={12} /></button>
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
        <span style={{ width: 4 }} />
        <span style={{ width: 22 }} />
        <span style={{ width: 110 }}>Timestamp</span>
        <span style={{ width: 60 }}>Level</span>
        <span style={{ width: 70 }}>Service</span>
        <span style={{ flex: 1 }}>Message</span>
      </div>

      {/* Log rows */}
      <div
        ref={scrollRef}
        className="os-scroll mono"
        style={{
          flex: 1,
          overflow: "auto",
          fontSize: 12,
          lineHeight: 1.55,
          background: "var(--bg)",
        }}
      >
        {filtered.map((l) => (
          <LogRow
            key={l.id}
            l={l}
            expanded={!!expanded[l.id]}
            onToggle={() => setExpanded((e) => ({ ...e, [l.id]: !e[l.id] }))}
            wrap={wrap}
          />
        ))}
        {filtered.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: "var(--fg-3)", fontSize: 13 }}>
            No logs match these filters.
          </div>
        )}
      </div>
    </div>
  );
}

function LogRow({
  l,
  expanded,
  onToggle,
  wrap,
}: {
  l: LogLine;
  expanded: boolean;
  onToggle: () => void;
  wrap: boolean;
}) {
  const tone = LOG_LEVEL_TONE[l.level];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        borderBottom: "1px solid var(--border)",
        background: expanded ? "var(--bg-overlay)" : "transparent",
        cursor: "pointer",
      }}
      onClick={onToggle}
    >
      <span style={{ width: 4, alignSelf: "stretch", background: tone, flex: "none" }} />
      <span style={{ width: 22, padding: "6px 4px", color: "var(--fg-4)", flex: "none" }}>
        <I.chev width={10} height={10} style={{ transform: expanded ? "rotate(90deg)" : "none" }} />
      </span>
      <span style={{ width: 110, padding: "6px 4px", color: "var(--fg-3)", flex: "none" }}>{l.ts}</span>
      <span
        style={{
          width: 60,
          padding: "6px 4px",
          color: tone,
          fontWeight: 500,
          flex: "none",
          textTransform: "uppercase",
          fontSize: 10,
          letterSpacing: "0.04em",
        }}
      >
        {l.level}
      </span>
      <span style={{ width: 70, padding: "6px 4px", color: "var(--fg-2)", flex: "none" }}>{l.svc}</span>
      <span
        style={{
          flex: 1,
          padding: "6px 12px 6px 4px",
          whiteSpace: wrap ? "pre-wrap" : "nowrap",
          overflow: wrap ? "visible" : "hidden",
          textOverflow: wrap ? "clip" : "ellipsis",
          color: "var(--fg)",
          wordBreak: wrap ? "break-word" : "normal",
        }}
      >
        {l.msg}
        {expanded && (
          <div
            style={{
              marginTop: 8,
              padding: 10,
              background: "var(--bg-sunken)",
              borderRadius: 4,
              border: "1px solid var(--border)",
              fontSize: 11,
              color: "var(--fg-2)",
              lineHeight: 1.7,
            }}
          >
            <div>
              <span style={{ color: "var(--fg-3)" }}>trace_id   </span>
              {l.id}-{rid()}
            </div>
            <div>
              <span style={{ color: "var(--fg-3)" }}>replica    </span>
              {l.svc}-{rint(1, 4)}
            </div>
            <div>
              <span style={{ color: "var(--fg-3)" }}>region     </span>
              sf-bay/rack-2
            </div>
            <div>
              <span style={{ color: "var(--fg-3)" }}>request_id </span>
              req_{rid()}
              {rid()}
            </div>
          </div>
        )}
      </span>
    </div>
  );
}
