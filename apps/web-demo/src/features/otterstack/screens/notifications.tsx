// Notifications — channel routing for deploy / build / health / security events.
// All data inline; matrix lets you toggle which channel receives which event.

import { useMemo, useState } from "react";

import { SvglLogo } from "../brand/svgl-logo";
import { I } from "../icons";
import { Field, SectionH } from "../components/form";

type ChannelKind =
  | "slack"
  | "discord"
  | "email"
  | "webhook"
  | "telegram"
  | "pagerduty";
type ChannelStatus = "active" | "warn" | "paused" | "disconnected";

type Channel = {
  id: string;
  name: string;
  kind: ChannelKind;
  target: string;
  transport: string;
  events7d: number;
  lastDelivery: string;
  status: ChannelStatus;
  note?: string;
};

const CHANNELS_SEED: Channel[] = [
  {
    id: "ch_slack",
    name: "#otterstack-deploys",
    kind: "slack",
    target: "hooks.slack.com/services/T0XXX/B0YYY/zzz••••",
    transport: "incoming-webhook",
    events7d: 142,
    lastDelivery: "4m ago",
    status: "active",
  },
  {
    id: "ch_discord",
    name: "#alerts",
    kind: "discord",
    target: "discord.com/api/webhooks/8841…/••••",
    transport: "webhook",
    events7d: 38,
    lastDelivery: "2h ago",
    status: "active",
  },
  {
    id: "ch_email",
    name: "oncall@paperhouse.dev",
    kind: "email",
    target: "oncall@paperhouse.dev",
    transport: "SMTP via Postmark",
    events7d: 12,
    lastDelivery: "4h ago",
    status: "active",
  },
  {
    id: "ch_webhook",
    name: "helio-oncall webhook",
    kind: "webhook",
    target: "https://hooks.helio.so/oncall",
    transport: "POST · HMAC-SHA256",
    events7d: 27,
    lastDelivery: "31m ago",
    status: "warn",
    note: "3 failed deliveries in 24h",
  },
  {
    id: "ch_telegram",
    name: "Telegram",
    kind: "telegram",
    target: "—",
    transport: "bot · long-poll",
    events7d: 0,
    lastDelivery: "never",
    status: "disconnected",
  },
];

type Severity = "info" | "ok" | "warn" | "err";

type EventRow = { id: string; label: string; severity: Severity };

const EVENTS: EventRow[] = [
  { id: "deploy.started", label: "Deploy started", severity: "info" },
  { id: "deploy.succeeded", label: "Deploy succeeded", severity: "ok" },
  { id: "deploy.failed", label: "Deploy failed", severity: "err" },
  { id: "build.failed", label: "Build failed", severity: "err" },
  { id: "health.degraded", label: "Health degraded", severity: "warn" },
  { id: "health.recovered", label: "Health recovered", severity: "ok" },
  { id: "cert.expiring", label: "Cert expiring soon", severity: "warn" },
  { id: "cert.renewed", label: "Cert renewed", severity: "ok" },
  { id: "backup.failed", label: "Backup failed", severity: "err" },
  { id: "backup.succeeded", label: "Backup succeeded", severity: "ok" },
  { id: "ssh.rotated", label: "SSH key rotated", severity: "info" },
  { id: "audit.anomaly", label: "Audit anomaly", severity: "warn" },
];

// Default subscription matrix: channel id → set of event ids.
const DEFAULT_SUBS: Record<string, Set<string>> = {
  ch_slack: new Set([
    "deploy.started",
    "deploy.succeeded",
    "deploy.failed",
    "build.failed",
    "health.degraded",
    "health.recovered",
  ]),
  ch_discord: new Set([
    "deploy.failed",
    "build.failed",
    "health.degraded",
    "audit.anomaly",
  ]),
  ch_email: new Set([
    "cert.expiring",
    "cert.renewed",
    "backup.failed",
    "audit.anomaly",
  ]),
  ch_webhook: new Set([
    "deploy.failed",
    "health.degraded",
    "audit.anomaly",
    "backup.failed",
  ]),
  ch_telegram: new Set(),
};

const KIND_META: Record<
  ChannelKind,
  { label: string; search?: string; sub: string }
> = {
  slack: {
    label: "Slack",
    search: "Slack",
    sub: "Slack workspace · incoming webhook",
  },
  discord: {
    label: "Discord",
    search: "Discord",
    sub: "Discord channel webhook",
  },
  email: { label: "Email", sub: "Outbound SMTP" },
  webhook: { label: "Webhook", sub: "Generic POST + HMAC" },
  telegram: { label: "Telegram", search: "Telegram", sub: "Telegram bot" },
  pagerduty: { label: "PagerDuty", search: "PagerDuty", sub: "Events API v2" },
};

const SEVERITY_COLOR: Record<Severity, string> = {
  info: "var(--info)",
  ok: "var(--ok)",
  warn: "var(--warn)",
  err: "var(--err)",
};

export function Notifications() {
  const [channels, setChannels] = useState<Channel[]>(CHANNELS_SEED);
  const [subs, setSubs] = useState<Record<string, Set<string>>>(() => {
    const out: Record<string, Set<string>> = {};
    for (const c of CHANNELS_SEED)
      out[c.id] = new Set(DEFAULT_SUBS[c.id] ?? []);
    return out;
  });
  const [addOpen, setAddOpen] = useState(false);

  const toggleSub = (channelId: string, eventId: string) =>
    setSubs((s) => {
      const next = { ...s };
      const set = new Set(next[channelId] ?? []);
      if (set.has(eventId)) set.delete(eventId);
      else set.add(eventId);
      next[channelId] = set;
      return next;
    });

  const setChannelStatus = (id: string, status: ChannelStatus) =>
    setChannels((cs) => cs.map((c) => (c.id === id ? { ...c, status } : c)));

  const removeChannel = (id: string) => {
    setChannels((cs) => cs.filter((c) => c.id !== id));
    setSubs((s) => {
      const next = { ...s };
      delete next[id];
      return next;
    });
  };

  const addChannel = (c: Channel) => {
    setChannels((cs) => [...cs, c]);
    setSubs((s) => ({ ...s, [c.id]: new Set() }));
  };

  return (
    <div
      className="os-scroll"
      style={{ flex: 1, overflow: "auto", padding: 24 }}
    >
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div className="row" style={{ marginBottom: 16 }}>
          <SectionH
            title="Notifications"
            sub="Routes deploy, build, health, and security events to your channels."
          />
          <div style={{ flex: 1 }} />
          <button className="btn primary" onClick={() => setAddOpen(true)}>
            <I.plus width={13} height={13} /> Add channel
          </button>
        </div>

        <div className="col gap-3" style={{ marginBottom: 24 }}>
          {channels.map((c) => (
            <ChannelCard
              key={c.id}
              channel={c}
              onTest={() => {
                /* no-op */
              }}
              onPause={() =>
                setChannelStatus(
                  c.id,
                  c.status === "paused" ? "active" : "paused",
                )
              }
              onDelete={() => removeChannel(c.id)}
            />
          ))}
        </div>

        <SubscriptionMatrix
          channels={channels}
          subs={subs}
          onToggle={toggleSub}
        />
      </div>

      {addOpen && (
        <AddChannelModal
          onClose={() => setAddOpen(false)}
          onAdd={(c) => {
            addChannel(c);
            setAddOpen(false);
          }}
        />
      )}
    </div>
  );
}

function KindMonogram({
  kind,
  size = 28,
}: {
  kind: ChannelKind;
  size?: number;
}) {
  const meta = KIND_META[kind];
  if (meta.search) {
    return (
      <SvglLogo
        search={meta.search}
        fallback={meta.label}
        size={size}
        background="var(--bg-sunken)"
        color="var(--fg)"
        border="1px solid var(--border)"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: 6,
        background: "var(--bg-sunken)",
        color: "var(--fg-2)",
        border: "1px solid var(--border)",
        fontWeight: 700,
        fontSize: Math.round(size * 0.5),
        letterSpacing: "-0.02em",
      }}
    >
      {meta.label[0]}
    </span>
  );
}

function StatusPill({ status }: { status: ChannelStatus }) {
  if (status === "active")
    return (
      <span className="badge ok">
        <span className="dot" />
        active
      </span>
    );
  if (status === "warn")
    return (
      <span className="badge warn">
        <span className="dot" />
        degraded
      </span>
    );
  if (status === "paused")
    return (
      <span className="badge">
        <span className="dot" />
        paused
      </span>
    );
  return (
    <span className="badge">
      <span className="dot" />
      disconnected
    </span>
  );
}

function ChannelCard({
  channel,
  onTest,
  onPause,
  onDelete,
}: {
  channel: Channel;
  onTest: () => void;
  onPause: () => void;
  onDelete: () => void;
}) {
  const meta = KIND_META[channel.kind];
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="row gap-3" style={{ alignItems: "flex-start" }}>
        <KindMonogram kind={channel.kind} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            className="row gap-2"
            style={{ alignItems: "center", marginBottom: 4 }}
          >
            <span style={{ fontWeight: 600, fontSize: 13 }}>
              {channel.name}
            </span>
            <span
              className="badge mono"
              style={{
                background: "var(--bg-overlay)",
                fontSize: 10,
                color: "var(--fg-3)",
              }}
            >
              {meta.label}
            </span>
            <span className="muted" style={{ fontSize: 11 }}>
              {channel.transport}
            </span>
            <div style={{ flex: 1 }} />
            <StatusPill status={channel.status} />
          </div>
          <div
            className="mono"
            style={{
              fontSize: 11,
              color: "var(--fg-3)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {channel.target}
          </div>
          <div
            className="row gap-3"
            style={{ marginTop: 8, fontSize: 11, color: "var(--fg-3)" }}
          >
            <span>
              <span className="mono" style={{ color: "var(--fg-2)" }}>
                {channel.events7d}
              </span>{" "}
              events · 7d
            </span>
            <span>
              last delivery{" "}
              <span className="mono" style={{ color: "var(--fg-2)" }}>
                {channel.lastDelivery}
              </span>
            </span>
            {channel.note && (
              <span style={{ color: "var(--warn)" }}>
                <I.warning width={10} height={10} /> {channel.note}
              </span>
            )}
          </div>
        </div>
        <div className="row gap-1" style={{ alignSelf: "center" }}>
          <button className="btn sm" onClick={onTest}>
            <I.bolt width={11} height={11} /> Test
          </button>
          <button className="btn sm">
            <I.edit width={11} height={11} /> Edit
          </button>
          <button className="btn sm" onClick={onPause}>
            {channel.status === "paused" ? "Resume" : "Pause"}
          </button>
          <button
            className="btn ghost icon sm"
            onClick={onDelete}
            title="Delete channel"
          >
            <I.trash width={12} height={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

function SubscriptionMatrix({
  channels,
  subs,
  onToggle,
}: {
  channels: Channel[];
  subs: Record<string, Set<string>>;
  onToggle: (channelId: string, eventId: string) => void;
}) {
  return (
    <div>
      <div className="row" style={{ marginBottom: 10 }}>
        <SectionH
          title="Event subscription matrix"
          sub="Toggle which events deliver to which channel"
        />
      </div>
      <div className="card" style={{ overflow: "hidden" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `1fr 90px repeat(${channels.length}, minmax(110px, 1fr))`,
            alignItems: "center",
            padding: "10px 14px",
            background: "var(--bg-sunken)",
            borderBottom: "1px solid var(--border)",
            fontSize: 11,
            color: "var(--fg-3)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          <span>Event</span>
          <span>Severity</span>
          {channels.map((c) => (
            <span
              key={c.id}
              className="row gap-2"
              style={{ alignItems: "center" }}
            >
              <KindMonogram kind={c.kind} size={18} />
              <span
                style={{
                  textTransform: "none",
                  letterSpacing: 0,
                  color: "var(--fg-2)",
                  fontSize: 11,
                }}
              >
                {KIND_META[c.kind].label}
              </span>
            </span>
          ))}
        </div>
        {EVENTS.map((ev, i) => (
          <div
            key={ev.id}
            style={{
              display: "grid",
              gridTemplateColumns: `1fr 90px repeat(${channels.length}, minmax(110px, 1fr))`,
              alignItems: "center",
              padding: "10px 14px",
              borderTop: i > 0 ? "1px solid var(--border)" : "none",
              fontSize: 12,
            }}
          >
            <span style={{ color: "var(--fg)" }}>{ev.label}</span>
            <span className="row gap-2" style={{ alignItems: "center" }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: SEVERITY_COLOR[ev.severity],
                }}
              />
              <span className="muted mono" style={{ fontSize: 10 }}>
                {ev.severity}
              </span>
            </span>
            {channels.map((c) => {
              const on = subs[c.id]?.has(ev.id) ?? false;
              const disabled = c.status === "disconnected";
              return (
                <span key={c.id}>
                  <MatrixToggle
                    on={on}
                    disabled={disabled}
                    onClick={() => !disabled && onToggle(c.id, ev.id)}
                  />
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function MatrixToggle({
  on,
  disabled,
  onClick,
}: {
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      style={{
        width: 24,
        height: 14,
        borderRadius: 999,
        background: on ? "var(--fg)" : "var(--border-strong)",
        position: "relative",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        border: 0,
        padding: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: on ? 12 : 2,
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: "var(--bg-elev)",
          transition: "left 140ms",
        }}
      />
    </button>
  );
}

function AddChannelModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (c: Channel) => void;
}) {
  const [kind, setKind] = useState<ChannelKind>("slack");
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");

  const placeholders: Record<
    ChannelKind,
    { name: string; target: string; transport: string }
  > = {
    slack: {
      name: "#otterstack-deploys",
      target: "https://hooks.slack.com/services/...",
      transport: "incoming-webhook",
    },
    discord: {
      name: "#alerts",
      target: "https://discord.com/api/webhooks/...",
      transport: "webhook",
    },
    email: {
      name: "oncall@team.dev",
      target: "oncall@team.dev",
      transport: "SMTP via Postmark",
    },
    webhook: {
      name: "internal-oncall",
      target: "https://hooks.example.com/oncall",
      transport: "POST · HMAC-SHA256",
    },
    telegram: {
      name: "Telegram",
      target: "chat_id: 123456789",
      transport: "bot · long-poll",
    },
    pagerduty: {
      name: "PagerDuty service",
      target: "Routing key (R0...)",
      transport: "Events API v2",
    },
  };

  const submit = () => {
    const meta = placeholders[kind];
    onAdd({
      id: "ch_" + Math.random().toString(36).slice(2, 8),
      name: name || meta.name,
      kind,
      target: target || meta.target,
      transport: meta.transport,
      events7d: 0,
      lastDelivery: "never",
      status: "active",
    });
  };

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
      <div
        onClick={(e) => e.stopPropagation()}
        className="os-modal"
        style={{ width: 560 }}
      >
        <div className="row gap-2 os-modal-h">
          <I.plus width={14} height={14} />
          <span style={{ fontWeight: 600 }}>Add notification channel</span>
          <div style={{ flex: 1 }} />
          <button className="btn ghost icon sm" onClick={onClose}>
            <I.close width={13} height={13} />
          </button>
        </div>
        <div
          className="col gap-3"
          style={{ padding: 18, overflow: "auto", maxHeight: "70vh" }}
        >
          <div>
            <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
              Channel type
            </div>
            <div className="row gap-2" style={{ flexWrap: "wrap" }}>
              {(Object.keys(KIND_META) as ChannelKind[]).map((k) => {
                const active = kind === k;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    className="row gap-2"
                    style={{
                      padding: "8px 10px",
                      borderRadius: 6,
                      border: `1px solid ${active ? "var(--fg)" : "var(--border)"}`,
                      background: active ? "var(--bg-overlay)" : "transparent",
                      cursor: "pointer",
                      fontSize: 12,
                      color: "var(--fg)",
                      alignItems: "center",
                    }}
                  >
                    <KindMonogram kind={k} size={20} />
                    <span>{KIND_META[k].label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <Field label="Display name">
            <input
              className="input"
              placeholder={placeholders[kind].name}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          {(kind === "slack" || kind === "discord" || kind === "webhook") && (
            <Field label={kind === "webhook" ? "POST endpoint" : "Webhook URL"}>
              <input
                className="input mono"
                placeholder={placeholders[kind].target}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
            </Field>
          )}

          {kind === "email" && (
            <>
              <Field label="Recipient address">
                <input
                  className="input mono"
                  placeholder={placeholders.email.target}
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                />
              </Field>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                }}
              >
                <Field label="SMTP host">
                  <input
                    className="input mono"
                    defaultValue="smtp.postmarkapp.com"
                  />
                </Field>
                <Field label="From address">
                  <input
                    className="input mono"
                    defaultValue="alerts@otterstack.dev"
                  />
                </Field>
              </div>
            </>
          )}

          {kind === "telegram" && (
            <>
              <Field label="Bot token">
                <input className="input mono" placeholder="123456:ABC-DEF…" />
              </Field>
              <Field label="Chat ID">
                <input
                  className="input mono"
                  placeholder="-1001234567890"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                />
              </Field>
            </>
          )}

          {kind === "pagerduty" && (
            <Field label="Integration routing key">
              <input
                className="input mono"
                placeholder={placeholders.pagerduty.target}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
            </Field>
          )}

          {kind === "webhook" && (
            <Field label="HMAC secret (optional)">
              <input className="input mono" placeholder="••••••••••••" />
            </Field>
          )}

          <div className="muted" style={{ fontSize: 11 }}>
            Otterstack will deliver a synthetic{" "}
            <span className="mono" style={{ color: "var(--fg-2)" }}>
              test.ping
            </span>{" "}
            event so you can confirm the channel wiring before subscribing it to
            real events.
          </div>
        </div>

        <div
          className="row gap-2"
          style={{ padding: 14, borderTop: "1px solid var(--border)" }}
        >
          <button className="btn">
            <I.bolt width={11} height={11} /> Send test
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit}>
            Save channel
          </button>
        </div>
      </div>
    </div>
  );
}
