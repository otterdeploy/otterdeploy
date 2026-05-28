// Webhooks — outbound (we send) and inbound (we receive). Outbound webhooks
// fire on platform events; inbound endpoints expose unique URLs that trigger
// service redeploys / scripts / notifications from external systems.

import * as React from "react";
import { useEffect, useMemo, useState } from "react";

import { I } from "../icons";
import { SERVICES } from "../data";

type Tab = "outbound" | "inbound";

type EventName =
  | "deploy.succeeded"
  | "deploy.failed"
  | "build.failed"
  | "health.degraded"
  | "node.added"
  | "node.removed"
  | "token.created"
  | "backup.completed"
  | "domain.tls.renewed";

interface Webhook {
  id: string;
  url: string;
  secret: string;
  events: EventName[];
  lastDeliveryRel: string;
  successRate: number;
  totalDeliveries: number;
  retry: string;
  status: "active" | "paused" | "failing";
}

interface Delivery {
  id: string;
  ts: string;
  target: string;
  event: EventName;
  code: number;
  attempt: number;
  latencyMs: number;
}

interface Inbound {
  id: string;
  url: string;
  name: string;
  target: string;
  secret: string;
  methods: string[];
  allowedIps: string;
  lastInvocationRel: string;
  status: "active" | "paused";
}

const ALL_EVENTS: EventName[] = [
  "deploy.succeeded",
  "deploy.failed",
  "build.failed",
  "health.degraded",
  "node.added",
  "node.removed",
  "token.created",
  "backup.completed",
  "domain.tls.renewed",
];

const INITIAL_OUTBOUND: Webhook[] = [
  {
    id: "wh_slack",
    url: "https://hooks.slack.com/services/T0123/B456/xxxx",
    secret: "whsec_a91c4f2a8d3b1e0f9c7d6a5b4c3d2e1f",
    events: ["deploy.succeeded", "deploy.failed", "health.degraded"],
    lastDeliveryRel: "2m ago",
    successRate: 99.4,
    totalDeliveries: 3812,
    retry: "exponential · max 5 attempts · 30s timeout",
    status: "active",
  },
  {
    id: "wh_pager",
    url: "https://events.pagerduty.com/integration/abc123/enqueue",
    secret: "whsec_77b3c1de4a98f6d2c4b8e0f1a9d7c6e5",
    events: ["deploy.failed", "build.failed", "health.degraded"],
    lastDeliveryRel: "21m ago",
    successRate: 100,
    totalDeliveries: 84,
    retry: "exponential · max 5 attempts · 30s timeout",
    status: "active",
  },
  {
    id: "wh_audit",
    url: "https://audit.helio.so/intake",
    secret: "whsec_22f1bc3a4e9d8c6b1a0f9e8d7c6b5a4f",
    events: [
      "deploy.succeeded",
      "deploy.failed",
      "build.failed",
      "health.degraded",
      "node.added",
      "node.removed",
      "token.created",
      "backup.completed",
      "domain.tls.renewed",
    ],
    lastDeliveryRel: "1h ago",
    successRate: 87.2,
    totalDeliveries: 12044,
    retry: "linear · max 3 attempts · 10s timeout",
    status: "failing",
  },
];

const INITIAL_DELIVERIES: Delivery[] = [
  { id: "dl_1", ts: "14:32:11", target: "hooks.slack.com", event: "deploy.succeeded", code: 200, attempt: 1, latencyMs: 142 },
  { id: "dl_2", ts: "14:18:42", target: "audit.helio.so", event: "deploy.succeeded", code: 502, attempt: 1, latencyMs: 4011 },
  { id: "dl_3", ts: "14:18:54", target: "audit.helio.so", event: "deploy.succeeded", code: 502, attempt: 2, latencyMs: 4022 },
  { id: "dl_4", ts: "14:19:18", target: "audit.helio.so", event: "deploy.succeeded", code: 200, attempt: 3, latencyMs: 188 },
  { id: "dl_5", ts: "13:51:02", target: "events.pagerduty.com", event: "health.degraded", code: 202, attempt: 1, latencyMs: 96 },
  { id: "dl_6", ts: "13:18:44", target: "hooks.slack.com", event: "deploy.failed", code: 200, attempt: 1, latencyMs: 121 },
  { id: "dl_7", ts: "12:42:11", target: "hooks.slack.com", event: "deploy.succeeded", code: 200, attempt: 1, latencyMs: 134 },
  { id: "dl_8", ts: "12:21:09", target: "audit.helio.so", event: "domain.tls.renewed", code: 504, attempt: 1, latencyMs: 5012 },
];

const INITIAL_INBOUND: Inbound[] = [
  {
    id: "ib_gh",
    url: "https://hooks.helio.so/in/abc123",
    name: "github-push-api",
    target: "Triggers redeploy of api",
    secret: "ghsec_a18c4f29d8b1e0f97c6d5a4b3c2d1e0f",
    methods: ["POST"],
    allowedIps: "140.82.112.0/20, 192.30.252.0/22",
    lastInvocationRel: "11m ago",
    status: "active",
  },
  {
    id: "ib_vc",
    url: "https://hooks.helio.so/in/def456",
    name: "vercel-preview-built",
    target: "Send notification to #deploys",
    secret: "vcsec_77b3c1de4a98f6d2c4b8e0f1a9d7c6e5",
    methods: ["POST"],
    allowedIps: "any",
    lastInvocationRel: "2h ago",
    status: "active",
  },
  {
    id: "ib_billing",
    url: "https://hooks.helio.so/in/ghi789",
    name: "external-billing-event",
    target: "Run a script · ./scripts/sync-stripe.sh",
    secret: "blsec_22f1bc3a4e9d8c6b1a0f9e8d7c6b5a4f",
    methods: ["POST"],
    allowedIps: "54.187.205.235, 54.187.216.72",
    lastInvocationRel: "1d ago",
    status: "paused",
  },
];

export function Webhooks() {
  const [tab, setTab] = useState<Tab>("outbound");
  const [outbound, setOutbound] = useState<Webhook[]>(INITIAL_OUTBOUND);
  const [inbound, setInbound] = useState<Inbound[]>(INITIAL_INBOUND);
  const [addOutbound, setAddOutbound] = useState(false);
  const [addInbound, setAddInbound] = useState(false);

  const togglePause = (id: string) =>
    setOutbound((ws) =>
      ws.map((w) =>
        w.id === id ? { ...w, status: w.status === "paused" ? "active" : "paused" } : w,
      ),
    );
  const removeOutbound = (id: string) => setOutbound((ws) => ws.filter((w) => w.id !== id));
  const removeInbound = (id: string) => setInbound((ws) => ws.filter((w) => w.id !== id));

  return (
    <div className="os-scroll" style={{ flex: 1, overflow: "auto", padding: 24 }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div className="row" style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Webhooks</h3>
            <span className="muted" style={{ fontSize: 12 }}>
              Outbound webhooks fire on platform events. Inbound endpoints receive triggers from your
              CI / GitHub / external services.
            </span>
          </div>
        </div>

        <div className="row" style={{ borderBottom: "1px solid var(--border)", marginBottom: 16, gap: 0 }}>
          <TabBtn active={tab === "outbound"} onClick={() => setTab("outbound")}>
            <I.upload width={11} height={11} /> Outbound · {outbound.length}
          </TabBtn>
          <TabBtn active={tab === "inbound"} onClick={() => setTab("inbound")}>
            <I.download width={11} height={11} /> Inbound · {inbound.length}
          </TabBtn>
        </div>

        {tab === "outbound" && (
          <div>
            <div className="row" style={{ marginBottom: 12 }}>
              <span className="muted" style={{ fontSize: 11 }}>
                Webhooks are delivered with HMAC-SHA256 signed payloads. Failed deliveries are retried.
              </span>
              <div style={{ flex: 1 }} />
              <button className="btn primary sm" onClick={() => setAddOutbound(true)}>
                <I.plus width={11} height={11} /> Add outbound webhook
              </button>
            </div>

            <div className="col gap-3">
              {outbound.map((w) => (
                <OutboundCard
                  key={w.id}
                  w={w}
                  onPause={() => togglePause(w.id)}
                  onDelete={() => removeOutbound(w.id)}
                />
              ))}
            </div>

            <div style={{ marginTop: 24 }}>
              <div
                className="muted"
                style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}
              >
                Recent deliveries
              </div>
              <div className="card" style={{ overflow: "hidden" }}>
                <div
                  className="row"
                  style={{
                    padding: "8px 12px",
                    background: "var(--bg-sunken)",
                    borderBottom: "1px solid var(--border)",
                    fontSize: 10,
                    color: "var(--fg-3)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}
                >
                  <span style={{ width: 90 }}>Time</span>
                  <span style={{ flex: 1 }}>Target</span>
                  <span style={{ width: 180 }}>Event</span>
                  <span style={{ width: 80, textAlign: "right" }}>Code</span>
                  <span style={{ width: 60, textAlign: "right" }}>Attempt</span>
                  <span style={{ width: 80, textAlign: "right" }}>Latency</span>
                </div>
                {INITIAL_DELIVERIES.map((d, i) => (
                  <div
                    key={d.id}
                    className="row"
                    style={{
                      padding: "8px 12px",
                      borderTop: i > 0 ? "1px solid var(--border)" : "none",
                      fontSize: 11.5,
                    }}
                  >
                    <span className="mono muted" style={{ width: 90 }}>
                      {d.ts}
                    </span>
                    <span className="mono" style={{ flex: 1, color: "var(--fg-2)" }}>
                      {d.target}
                    </span>
                    <span className="mono" style={{ width: 180 }}>
                      {d.event}
                    </span>
                    <span style={{ width: 80, textAlign: "right" }}>
                      <span
                        className={`badge ${d.code < 300 ? "ok" : d.code < 500 ? "warn" : "err"}`}
                        style={{ fontSize: 10 }}
                      >
                        {d.code}
                      </span>
                    </span>
                    <span className="mono muted" style={{ width: 60, textAlign: "right" }}>
                      #{d.attempt}
                    </span>
                    <span
                      className="mono"
                      style={{
                        width: 80,
                        textAlign: "right",
                        color: d.latencyMs > 1000 ? "var(--warn)" : "var(--fg-2)",
                      }}
                    >
                      {d.latencyMs}ms
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === "inbound" && (
          <div>
            <div className="row" style={{ marginBottom: 12 }}>
              <span className="muted" style={{ fontSize: 11 }}>
                Each endpoint exposes a unique URL. Requests are verified against the HMAC secret and
                source-IP allowlist before triggering the configured action.
              </span>
              <div style={{ flex: 1 }} />
              <button className="btn primary sm" onClick={() => setAddInbound(true)}>
                <I.plus width={11} height={11} /> Create endpoint
              </button>
            </div>

            <div className="col gap-3">
              {inbound.map((e) => (
                <InboundCard key={e.id} e={e} onDelete={() => removeInbound(e.id)} />
              ))}
            </div>
          </div>
        )}
      </div>

      {addOutbound && (
        <AddOutboundModal
          onClose={() => setAddOutbound(false)}
          onAdd={(w) => {
            setOutbound((ws) => [w, ...ws]);
            setAddOutbound(false);
          }}
        />
      )}
      {addInbound && (
        <AddInboundModal
          onClose={() => setAddInbound(false)}
          onAdd={(e) => {
            setInbound((es) => [e, ...es]);
            setAddInbound(false);
          }}
        />
      )}
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className="row gap-2"
      onClick={onClick}
      style={{
        padding: "10px 16px",
        background: "transparent",
        border: 0,
        cursor: "pointer",
        fontSize: 12,
        color: active ? "var(--fg)" : "var(--fg-3)",
        fontWeight: active ? 600 : 400,
        borderBottom: `2px solid ${active ? "var(--fg)" : "transparent"}`,
        marginBottom: -1,
      }}
    >
      {children}
    </button>
  );
}

function OutboundCard({
  w,
  onPause,
  onDelete,
}: {
  w: Webhook;
  onPause: () => void;
  onDelete: () => void;
}) {
  const [showSecret, setShowSecret] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) navigator.clipboard.writeText(w.secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="row gap-2" style={{ marginBottom: 10, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="mono" style={{ fontSize: 12.5, fontWeight: 500, color: "var(--fg)" }}>
            {w.url}
          </div>
          <div className="row gap-2" style={{ marginTop: 4 }}>
            <span
              className={`badge ${
                w.status === "active" ? "ok" : w.status === "paused" ? "" : "err"
              }`}
            >
              <span className="dot" />
              {w.status}
            </span>
            <span className="muted" style={{ fontSize: 11 }}>
              {w.totalDeliveries.toLocaleString()} deliveries · {w.successRate}% success · last{" "}
              {w.lastDeliveryRel}
            </span>
          </div>
        </div>
        <button className="btn sm">
          <I.bolt width={11} height={11} /> Test
        </button>
        <button className="btn sm">
          <I.edit width={11} height={11} /> Edit
        </button>
        <button className="btn sm" onClick={onPause}>
          {w.status === "paused" ? (
            <>
              <I.refresh width={11} height={11} /> Resume
            </>
          ) : (
            <>
              <I.lock width={11} height={11} /> Pause
            </>
          )}
        </button>
        <button className="btn sm" style={{ color: "var(--err)" }} onClick={onDelete}>
          <I.trash width={11} height={11} />
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <div
            className="muted"
            style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}
          >
            Events
          </div>
          <div className="row gap-1" style={{ flexWrap: "wrap" }}>
            {w.events.slice(0, 6).map((e) => (
              <span
                key={e}
                className="mono"
                style={{
                  fontSize: 10,
                  padding: "1px 6px",
                  borderRadius: 3,
                  background: "var(--bg-overlay)",
                  color: "var(--fg-2)",
                }}
              >
                {e}
              </span>
            ))}
            {w.events.length > 6 && (
              <span className="mono muted" style={{ fontSize: 10 }}>
                +{w.events.length - 6}
              </span>
            )}
          </div>
        </div>

        <div>
          <div
            className="muted"
            style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}
          >
            HMAC secret
          </div>
          <div
            className="row gap-1"
            style={{
              padding: "4px 8px",
              background: "var(--bg-sunken)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              fontSize: 11,
            }}
          >
            <span className="mono" style={{ flex: 1, color: "var(--fg-2)", overflow: "hidden", textOverflow: "ellipsis" }}>
              {showSecret ? w.secret : "••••••••••••••••••••••••••••••••"}
            </span>
            <button className="btn ghost icon sm" onClick={() => setShowSecret((s) => !s)}>
              <I.eye width={11} height={11} />
            </button>
            <button className="btn ghost icon sm" onClick={copy}>
              <I.copy width={11} height={11} />
            </button>
          </div>
          {copied && (
            <span className="muted" style={{ fontSize: 10, marginTop: 2, display: "inline-block" }}>
              copied
            </span>
          )}
        </div>
      </div>

      <div className="muted" style={{ fontSize: 11, marginTop: 10 }}>
        <I.refresh width={10} height={10} style={{ verticalAlign: "middle", marginRight: 4 }} />
        Retry policy: {w.retry}
      </div>
    </div>
  );
}

function InboundCard({ e, onDelete }: { e: Inbound; onDelete: () => void }) {
  const [copied, setCopied] = useState<"url" | "secret" | null>(null);
  const [showSecret, setShowSecret] = useState(false);

  const copy = (which: "url" | "secret", text: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="row gap-2" style={{ marginBottom: 10, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row gap-2" style={{ alignItems: "center" }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{e.name}</span>
            <span
              className={`badge ${e.status === "active" ? "ok" : ""}`}
              style={{ fontSize: 10 }}
            >
              <span className="dot" />
              {e.status}
            </span>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            {e.target}
          </div>
        </div>
        <button className="btn sm">
          <I.bolt width={11} height={11} /> Test
        </button>
        <button className="btn sm">
          <I.edit width={11} height={11} /> Edit
        </button>
        <button className="btn sm" style={{ color: "var(--err)" }} onClick={onDelete}>
          <I.trash width={11} height={11} />
        </button>
      </div>

      <div className="col gap-2">
        <div>
          <div
            className="muted"
            style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}
          >
            Endpoint URL
          </div>
          <div
            className="row gap-1"
            style={{
              padding: "6px 10px",
              background: "var(--bg-sunken)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              fontSize: 12,
            }}
          >
            <span className="mono" style={{ flex: 1, color: "var(--fg)" }}>
              {e.url}
            </span>
            <button className="btn ghost sm" onClick={() => copy("url", e.url)}>
              <I.copy width={11} height={11} /> {copied === "url" ? "Copied" : "Copy"}
            </button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <div>
            <div
              className="muted"
              style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}
            >
              HMAC secret
            </div>
            <div
              className="row gap-1"
              style={{
                padding: "4px 8px",
                background: "var(--bg-sunken)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                fontSize: 11,
              }}
            >
              <span
                className="mono"
                style={{ flex: 1, color: "var(--fg-2)", overflow: "hidden", textOverflow: "ellipsis" }}
              >
                {showSecret ? e.secret : "••••••••••••••••••••"}
              </span>
              <button className="btn ghost icon sm" onClick={() => setShowSecret((s) => !s)}>
                <I.eye width={11} height={11} />
              </button>
              <button className="btn ghost icon sm" onClick={() => copy("secret", e.secret)}>
                <I.copy width={11} height={11} />
              </button>
            </div>
          </div>
          <div>
            <div
              className="muted"
              style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}
            >
              Allowed methods
            </div>
            <div className="row gap-1">
              {e.methods.map((m) => (
                <span key={m} className="mono badge info" style={{ fontSize: 10 }}>
                  {m}
                </span>
              ))}
            </div>
          </div>
          <div>
            <div
              className="muted"
              style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}
            >
              Allowed source IPs
            </div>
            <span className="mono" style={{ fontSize: 11, color: "var(--fg-2)" }}>
              {e.allowedIps}
            </span>
          </div>
        </div>

        <div className="muted" style={{ fontSize: 11 }}>
          Last invocation {e.lastInvocationRel}
        </div>
      </div>
    </div>
  );
}

function AddOutboundModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (w: Webhook) => void;
}) {
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<EventName[]>(["deploy.succeeded", "deploy.failed"]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = () => {
    onAdd({
      id: `wh_${Math.random().toString(36).slice(2, 6)}`,
      url,
      secret: `whsec_${Math.random().toString(36).slice(2, 14)}${Math.random().toString(36).slice(2, 14)}`,
      events,
      lastDeliveryRel: "never",
      successRate: 100,
      totalDeliveries: 0,
      retry: "exponential · max 5 attempts · 30s timeout",
      status: "active",
    });
  };

  const toggle = (e: EventName) =>
    setEvents((cur) => (cur.includes(e) ? cur.filter((x) => x !== e) : [...cur, e]));

  return (
    <div
      onClick={onClose}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 200,
        background: "rgba(0,0,0,0.4)",
        display: "grid",
        placeItems: "center",
        backdropFilter: "blur(2px)",
      }}
    >
      <div onClick={(e) => e.stopPropagation()} className="os-modal" style={{ width: 540 }}>
        <div className="row gap-2 os-modal-h">
          <I.upload width={14} height={14} />
          <span style={{ fontWeight: 600 }}>Add outbound webhook</span>
          <div style={{ flex: 1 }} />
          <button className="btn ghost icon sm" onClick={onClose}>
            <I.close width={13} height={13} />
          </button>
        </div>
        <div className="col gap-3" style={{ padding: 18 }}>
          <label className="col gap-1">
            <span className="muted" style={{ fontSize: 11 }}>
              Target URL
            </span>
            <input
              className="input mono"
              autoFocus
              placeholder="https://hooks.example.com/intake"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>

          <div>
            <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
              Subscribe to events
            </div>
            <div className="row gap-2" style={{ flexWrap: "wrap" }}>
              {ALL_EVENTS.map((e) => {
                const on = events.includes(e);
                return (
                  <label
                    key={e}
                    className="row gap-1"
                    style={{
                      padding: "3px 8px",
                      border: `1px solid ${on ? "var(--fg-3)" : "var(--border)"}`,
                      borderRadius: 4,
                      cursor: "pointer",
                      background: on ? "var(--bg-overlay)" : "transparent",
                      fontSize: 11,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(e)}
                      style={{ margin: 0, accentColor: "var(--fg)" }}
                    />
                    <span className="mono">{e}</span>
                  </label>
                );
              })}
            </div>
          </div>
          <div className="muted" style={{ fontSize: 11 }}>
            We will generate an HMAC secret and sign every payload with the{" "}
            <span className="mono" style={{ color: "var(--fg-2)" }}>X-Otterdeploy-Signature</span> header.
          </div>
        </div>
        <div className="row gap-2" style={{ padding: 14, borderTop: "1px solid var(--border)" }}>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit} disabled={!url || events.length === 0}>
            <I.plus width={11} height={11} /> Create webhook
          </button>
        </div>
      </div>
    </div>
  );
}

function AddInboundModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (e: Inbound) => void;
}) {
  const [name, setName] = useState("");
  const [action, setAction] = useState<"redeploy" | "script" | "notify">("redeploy");
  const [target, setTarget] = useState(SERVICES[0]?.id ?? "");
  const [hmac, setHmac] = useState(true);
  const [allowed, setAllowed] = useState("");
  const [created, setCreated] = useState<Inbound | null>(null);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const description = useMemo(() => {
    if (action === "redeploy") return `Triggers redeploy of ${target}`;
    if (action === "script") return "Run a script · ./scripts/handler.sh";
    return "Send notification to #deploys";
  }, [action, target]);

  const submit = () => {
    const id = Math.random().toString(36).slice(2, 8);
    const c: Inbound = {
      id: `ib_${id}`,
      url: `https://hooks.helio.so/in/${id}`,
      name: name.trim() || "untitled-endpoint",
      target: description,
      secret: hmac
        ? `inhsec_${Math.random().toString(36).slice(2, 14)}${Math.random().toString(36).slice(2, 14)}`
        : "—",
      methods: ["POST"],
      allowedIps: allowed.trim() || "any",
      lastInvocationRel: "never",
      status: "active",
    };
    setCreated(c);
    onAdd(c);
  };

  const curlCmd = useMemo(() => {
    if (!created) return "";
    const sigLine = created.secret !== "—" ? ` \\\n  -H "X-Otterdeploy-Signature: <sha256-hmac>"` : "";
    return `curl -X POST ${created.url} \\\n  -H "Content-Type: application/json"${sigLine} \\\n  -d '{"event":"trigger"}'`;
  }, [created]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 200,
        background: "rgba(0,0,0,0.4)",
        display: "grid",
        placeItems: "center",
        backdropFilter: "blur(2px)",
      }}
    >
      <div onClick={(e) => e.stopPropagation()} className="os-modal" style={{ width: 600 }}>
        <div className="row gap-2 os-modal-h">
          <I.download width={14} height={14} />
          <span style={{ fontWeight: 600 }}>
            {created ? "Endpoint created" : "Create inbound endpoint"}
          </span>
          <div style={{ flex: 1 }} />
          <button className="btn ghost icon sm" onClick={onClose}>
            <I.close width={13} height={13} />
          </button>
        </div>

        {!created ? (
          <>
            <div className="col gap-3" style={{ padding: 18 }}>
              <label className="col gap-1">
                <span className="muted" style={{ fontSize: 11 }}>
                  Name
                </span>
                <input
                  className="input mono"
                  autoFocus
                  placeholder="github-push-api"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>

              <label className="col gap-1">
                <span className="muted" style={{ fontSize: 11 }}>
                  Target action
                </span>
                <select
                  className="input"
                  value={action}
                  onChange={(e) => setAction(e.target.value as "redeploy" | "script" | "notify")}
                >
                  <option value="redeploy">Redeploy a service</option>
                  <option value="script">Run a script</option>
                  <option value="notify">Send notification</option>
                </select>
              </label>

              {action === "redeploy" && (
                <label className="col gap-1">
                  <span className="muted" style={{ fontSize: 11 }}>
                    Service
                  </span>
                  <select
                    className="input mono"
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                  >
                    {SERVICES.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className="row gap-2" style={{ alignItems: "center", fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={hmac}
                  onChange={(e) => setHmac(e.target.checked)}
                  style={{ margin: 0, accentColor: "var(--fg)" }}
                />
                Auto-generate HMAC secret (recommended)
              </label>

              <label className="col gap-1">
                <span className="muted" style={{ fontSize: 11 }}>
                  IP allowlist (one per line, CIDR ok). Leave empty for any.
                </span>
                <textarea
                  className="input mono"
                  rows={3}
                  placeholder={"140.82.112.0/20\n192.30.252.0/22"}
                  value={allowed}
                  onChange={(e) => setAllowed(e.target.value)}
                />
              </label>
            </div>
            <div className="row gap-2" style={{ padding: 14, borderTop: "1px solid var(--border)" }}>
              <div style={{ flex: 1 }} />
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
              <button className="btn primary" onClick={submit}>
                <I.plus width={11} height={11} /> Create endpoint
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="col gap-3" style={{ padding: 18 }}>
              <div>
                <div
                  className="muted"
                  style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}
                >
                  Endpoint URL
                </div>
                <div
                  className="row gap-1"
                  style={{
                    padding: "8px 12px",
                    background: "var(--bg-sunken)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                >
                  <span className="mono" style={{ flex: 1, color: "var(--fg)" }}>
                    {created.url}
                  </span>
                  <button
                    className="btn sm"
                    onClick={() => {
                      if (typeof navigator !== "undefined" && navigator.clipboard)
                        navigator.clipboard.writeText(created.url);
                    }}
                  >
                    <I.copy width={11} height={11} /> Copy
                  </button>
                </div>
              </div>

              {created.secret !== "—" && (
                <div>
                  <div
                    className="muted"
                    style={{
                      fontSize: 10,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      marginBottom: 6,
                    }}
                  >
                    HMAC secret
                  </div>
                  <div
                    className="card mono"
                    style={{
                      padding: "10px 12px",
                      background: "var(--bg-sunken)",
                      fontSize: 11.5,
                      wordBreak: "break-all",
                      color: "var(--fg-2)",
                    }}
                  >
                    {created.secret}
                  </div>
                </div>
              )}

              <div>
                <div
                  className="muted"
                  style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}
                >
                  Test with curl
                </div>
                <pre
                  className="mono"
                  style={{
                    margin: 0,
                    padding: 12,
                    background: "var(--bg-sunken)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    fontSize: 11,
                    lineHeight: 1.7,
                    color: "var(--fg-2)",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {curlCmd}
                </pre>
              </div>
            </div>
            <div className="row gap-2" style={{ padding: 14, borderTop: "1px solid var(--border)" }}>
              <div style={{ flex: 1 }} />
              <button className="btn primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
