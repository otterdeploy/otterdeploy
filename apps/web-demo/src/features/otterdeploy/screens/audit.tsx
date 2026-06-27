// Audit log — immutable record of administrative actions across the cluster.
// The right-side drawer reuses the overlay pattern from servers.tsx
// (position: absolute inset 0; click-out + Escape close).

import * as React from "react";
import { useEffect, useMemo, useState } from "react";

import { TEAM, PROJECTS, type TeamMember } from "../data";
import { I } from "../icons";

type ActorKind = "human" | "api-token" | "system" | "automation";
type EventStatus = "success" | "denied" | "failed";

type AuditAction =
  | "deploy"
  | "rollback"
  | "restore"
  | "ssh-key.rotate"
  | "token.create"
  | "token.revoke"
  | "node.add"
  | "node.remove"
  | "variable.update"
  | "project.create"
  | "login"
  | "mfa-challenge"
  | "domain.add"
  | "database.snapshot";

type ResourceKind = "service" | "database" | "node" | "token" | "domain" | "user" | "project";

interface AuditEvent {
  id: string;
  ts: string;
  tsAbs: string;
  actor: { id: string; name: string; initials: string; kind: ActorKind };
  action: AuditAction;
  resource: { kind: ResourceKind; name: string; project?: string };
  status: EventStatus;
  ip: string;
  ua: string;
  geo: string;
  sessionId: string;
  parent?: string;
  correlated?: string[];
  request?: Record<string, unknown>;
  responseCode: number;
  anomaly?: string;
}

const ACTION_COLORS: Record<AuditAction, string> = {
  deploy: "var(--info)",
  rollback: "var(--warn)",
  restore: "var(--warn)",
  "ssh-key.rotate": "var(--info)",
  "token.create": "var(--ok, #4ade80)",
  "token.revoke": "var(--err)",
  "node.add": "var(--ok, #4ade80)",
  "node.remove": "var(--err)",
  "variable.update": "var(--info)",
  "project.create": "var(--ok, #4ade80)",
  login: "var(--info)",
  "mfa-challenge": "var(--info)",
  "domain.add": "var(--ok, #4ade80)",
  "database.snapshot": "var(--info)",
};

const RESOURCE_ICON: Record<ResourceKind, keyof typeof I> = {
  service: "service",
  database: "db",
  node: "server",
  token: "key",
  domain: "globe",
  user: "user",
  project: "folder",
};

const ACTIONS: AuditAction[] = [
  "deploy",
  "rollback",
  "restore",
  "ssh-key.rotate",
  "token.create",
  "token.revoke",
  "node.add",
  "node.remove",
  "variable.update",
  "project.create",
  "login",
  "mfa-challenge",
  "domain.add",
  "database.snapshot",
];

const fakeEvents = (): AuditEvent[] => {
  const mira = TEAM[0]!;
  const arjun = TEAM[1]!;
  const lin = TEAM[2]!;
  const kai = TEAM[3]!;
  const mk = (
    id: string,
    ts: string,
    actor: TeamMember | { id: string; name: string; initials: string; kind: ActorKind },
    action: AuditAction,
    resource: AuditEvent["resource"],
    extra: Partial<AuditEvent> = {},
  ): AuditEvent => {
    const a =
      "kind" in actor
        ? actor
        : { id: actor.id, name: actor.name, initials: actor.initials, kind: "human" as ActorKind };
    return {
      id,
      ts,
      tsAbs: `2026-05-03 ${ts} UTC`,
      actor: a,
      action,
      resource,
      status: "success",
      ip: "24.2.1.4",
      ua: "otterctl/1.4.2 (darwin; arm64)",
      geo: "San Francisco",
      sessionId: `sess_${id.slice(0, 6)}`,
      responseCode: 200,
      request: { method: "POST", path: `/v1/${resource.kind}s/${resource.name}` },
      ...extra,
    };
  };
  return [
    mk(
      "ev_a01",
      "14:32:11",
      mira,
      "deploy",
      { kind: "service", name: "web", project: "helio" },
      {
        request: { commit: "8a2c1f9", env: "production", replicas: 3, builder: "railpack" },
        correlated: ["ev_a02", "ev_a03"],
      },
    ),
    mk(
      "ev_a02",
      "14:31:55",
      mira,
      "variable.update",
      { kind: "service", name: "web", project: "helio" },
      {
        request: { keys: ["NEXT_PUBLIC_API_URL"], env: "production" },
        parent: "ev_a01",
      },
    ),
    mk(
      "ev_a03",
      "14:30:09",
      { id: "sys", name: "system", initials: "SY", kind: "system" },
      "database.snapshot",
      {
        kind: "database",
        name: "postgres",
        project: "helio",
      },
    ),
    mk(
      "ev_a04",
      "13:51:02",
      arjun,
      "deploy",
      { kind: "service", name: "api", project: "helio" },
      {
        request: { commit: "3f9b042", env: "production", replicas: 4 },
      },
    ),
    mk(
      "ev_a05",
      "13:18:44",
      arjun,
      "rollback",
      { kind: "service", name: "api", project: "helio" },
      {
        status: "success",
        request: { from: "fe19a02", to: "3f9b042" },
        correlated: ["ev_a04"],
      },
    ),
    mk(
      "ev_a06",
      "12:42:11",
      { id: "ci-bot", name: "paperhouse-ci", initials: "CI", kind: "api-token" },
      "deploy",
      {
        kind: "service",
        name: "worker",
        project: "helio",
      },
      { request: { commit: "c1ad5e2", env: "production" } },
    ),
    mk(
      "ev_a07",
      "12:21:09",
      lin,
      "domain.add",
      { kind: "domain", name: "blog.helio.so" },
      {
        request: { tls: "letsencrypt", target: "web" },
      },
    ),
    mk(
      "ev_a08",
      "11:58:43",
      mira,
      "token.create",
      { kind: "token", name: "grafana-readonly" },
      {
        request: { scopes: ["read:projects", "read:metrics", "read:logs"], expiry: "365d" },
      },
    ),
    mk(
      "ev_a09",
      "11:55:01",
      { id: "sys", name: "system", initials: "SY", kind: "system" },
      "ssh-key.rotate",
      {
        kind: "node",
        name: "helio-prod-02",
      },
      { request: { algorithm: "ed25519" } },
    ),
    mk(
      "ev_a10",
      "11:14:22",
      arjun,
      "node.add",
      { kind: "node", name: "helio-prod-04" },
      {
        request: { region: "sfo", role: "worker" },
      },
    ),
    mk(
      "ev_a11",
      "10:42:00",
      kai,
      "deploy",
      { kind: "service", name: "web", project: "helio" },
      {
        status: "denied",
        responseCode: 403,
        request: { reason: "missing scope: write:services" },
      },
    ),
    mk("ev_a12", "10:32:55", kai, "login", { kind: "user", name: "kai@paperhouse.dev" }),
    mk(
      "ev_a13",
      "10:32:45",
      kai,
      "mfa-challenge",
      { kind: "user", name: "kai@paperhouse.dev" },
      {
        status: "success",
      },
    ),
    mk(
      "ev_a14",
      "09:55:11",
      { id: "auto-scaler", name: "autoscaler", initials: "AS", kind: "automation" },
      "deploy",
      { kind: "service", name: "api", project: "helio" },
      { request: { reason: "autoscale", replicas: 4 } },
    ),
    mk(
      "ev_a15",
      "09:31:00",
      arjun,
      "variable.update",
      { kind: "service", name: "api", project: "billing" },
      {
        request: { keys: ["STRIPE_SECRET_KEY"] },
      },
    ),
    mk("ev_a16", "09:15:45", mira, "project.create", { kind: "project", name: "internal-tools" }),
    mk(
      "ev_a17",
      "08:42:09",
      { id: "sys", name: "system", initials: "SY", kind: "system" },
      "database.snapshot",
      {
        kind: "database",
        name: "redis",
        project: "helio",
      },
    ),
    mk(
      "ev_a18",
      "08:01:33",
      arjun,
      "restore",
      { kind: "database", name: "postgres", project: "helio" },
      {
        request: { snapshot: "snap_2026-05-02-22:00", target: "staging" },
      },
    ),
    mk("ev_a19", "07:49:18", lin, "deploy", {
      kind: "service",
      name: "imgproxy",
      project: "marketing",
    }),
    mk(
      "ev_a20",
      "07:14:00",
      { id: "ci-bot", name: "paperhouse-ci", initials: "CI", kind: "api-token" },
      "deploy",
      {
        kind: "service",
        name: "web",
        project: "helio",
      },
      { status: "failed", responseCode: 500, request: { reason: "build timed out at 14m" } },
    ),
    mk(
      "ev_a21",
      "06:42:11",
      { id: "anon", name: "unknown", initials: "??", kind: "human" },
      "login",
      { kind: "user", name: "mira@paperhouse.dev" },
      {
        status: "denied",
        responseCode: 401,
        ip: "185.220.101.12",
        geo: "Helsinki, FI (TOR exit)",
        anomaly: "login from new geography + TOR exit node",
      },
    ),
    mk(
      "ev_a22",
      "06:31:02",
      { id: "leaked-token", name: "leaked-laptop-key", initials: "LK", kind: "api-token" },
      "token.revoke",
      { kind: "token", name: "leaked-laptop-key" },
      {
        anomaly: "token used from 6 distinct IPs in 1h before automatic revoke",
        status: "success",
      },
    ),
    mk(
      "ev_a23",
      "05:58:11",
      { id: "sys", name: "system", initials: "SY", kind: "system" },
      "node.remove",
      {
        kind: "node",
        name: "helio-prod-old",
      },
      { request: { reason: "drained" } },
    ),
    mk("ev_a24", "05:24:00", mira, "token.revoke", { kind: "token", name: "old-deploy-bot" }),
    mk("ev_a25", "04:51:40", arjun, "deploy", {
      kind: "service",
      name: "worker",
      project: "helio",
    }),
    mk(
      "ev_a26",
      "04:12:09",
      lin,
      "variable.update",
      { kind: "service", name: "web", project: "helio" },
      {
        request: { keys: ["REVALIDATE_SECRET"] },
      },
    ),
    mk(
      "ev_a27",
      "03:31:18",
      { id: "sys", name: "system", initials: "SY", kind: "system" },
      "ssh-key.rotate",
      {
        kind: "node",
        name: "helio-prod-03",
      },
    ),
    mk(
      "ev_a28",
      "02:42:00",
      { id: "ci-bot", name: "paperhouse-ci", initials: "CI", kind: "api-token" },
      "deploy",
      {
        kind: "service",
        name: "api",
        project: "billing",
      },
    ),
    mk(
      "ev_a29",
      "01:12:11",
      arjun,
      "rollback",
      { kind: "service", name: "web", project: "helio" },
      {
        request: { from: "5b2e8d1", to: "e042bb1" },
      },
    ),
    mk("ev_a30", "00:18:05", mira, "login", { kind: "user", name: "mira@paperhouse.dev" }),
  ];
};

const RANGES = [
  { id: "24h", label: "Last 24h" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "90d", label: "Last 90 days" },
  { id: "custom", label: "Custom" },
];

export function Audit() {
  const [events] = useState<AuditEvent[]>(() => fakeEvents());
  const [open, setOpen] = useState<string | null>(null);
  const [range, setRange] = useState("24h");
  const [actor, setActor] = useState<string>("any");
  const [action, setAction] = useState<string>("any");
  const [resource, setResource] = useState<string>("any");
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    return events.filter((e) => {
      if (actor !== "any" && e.actor.id !== actor) return false;
      if (action !== "any" && e.action !== action) return false;
      if (resource !== "any" && e.resource.kind !== resource) return false;
      if (q.trim()) {
        const needle = q.toLowerCase();
        if (
          !e.id.toLowerCase().includes(needle) &&
          !e.resource.name.toLowerCase().includes(needle) &&
          !e.actor.name.toLowerCase().includes(needle)
        )
          return false;
      }
      return true;
    });
  }, [events, actor, action, resource, q]);

  const stats = useMemo(() => {
    const total = events.length;
    const failed = events.filter((e) => e.status !== "success").length;
    const anomalies = events.filter((e) => !!e.anomaly).length;
    return { total, failed, anomalies };
  }, [events]);

  const opening = events.find((e) => e.id === open);

  const actorOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    events.forEach((e) => map.set(e.actor.id, { id: e.actor.id, name: e.actor.name }));
    return Array.from(map.values());
  }, [events]);

  return (
    <div
      className="os-scroll"
      style={{ flex: 1, overflow: "auto", padding: 24, position: "relative" }}
    >
      <div style={{ maxWidth: 1300, margin: "0 auto" }}>
        <div className="row" style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Audit log</h3>
            <span className="muted" style={{ fontSize: 12 }}>
              Immutable record of every administrative action across this cluster.
            </span>
          </div>
          <div style={{ flex: 1 }} />
          <button className="btn ghost sm">
            <I.download width={11} height={11} /> Export CSV
          </button>
        </div>

        <div className="card row gap-2" style={{ padding: 10, marginBottom: 12, flexWrap: "wrap" }}>
          <select
            className="input"
            value={range}
            onChange={(e) => setRange(e.target.value)}
            style={{ height: 28, padding: "0 8px", fontSize: 12, width: 130 }}
          >
            {RANGES.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
          <select
            className="input"
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            style={{ height: 28, padding: "0 8px", fontSize: 12, width: 180 }}
          >
            <option value="any">All actors</option>
            {actorOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select
            className="input"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            style={{ height: 28, padding: "0 8px", fontSize: 12, width: 180 }}
          >
            <option value="any">All actions</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <select
            className="input"
            value={resource}
            onChange={(e) => setResource(e.target.value)}
            style={{ height: 28, padding: "0 8px", fontSize: 12, width: 150 }}
          >
            <option value="any">All resources</option>
            <option value="service">service</option>
            <option value="database">database</option>
            <option value="node">node</option>
            <option value="token">token</option>
            <option value="domain">domain</option>
            <option value="user">user</option>
            <option value="project">project</option>
          </select>
          <div style={{ flex: 1 }} />
          <div style={{ position: "relative" }}>
            <I.search
              width={11}
              height={11}
              style={{
                position: "absolute",
                top: "50%",
                left: 8,
                transform: "translateY(-50%)",
                color: "var(--fg-3)",
              }}
            />
            <input
              className="input"
              placeholder="Search id / name / actor"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ paddingLeft: 24, height: 28, width: 240, fontSize: 12 }}
            />
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 12,
            marginBottom: 16,
          }}
        >
          <Stat label="Events · 24h" value={stats.total.toString()} sub="across all projects" />
          <Stat
            label="Failed actions"
            value={stats.failed.toString()}
            sub="denied or errored"
            tone={stats.failed > 0 ? "warn" : "ok"}
          />
          <Stat
            label="Anomalies flagged"
            value={stats.anomalies.toString()}
            sub="auto-flagged for review"
            tone={stats.anomalies > 0 ? "err" : "ok"}
          />
        </div>

        <div className="card" style={{ overflow: "hidden" }}>
          <div
            className="row"
            style={{
              padding: "10px 14px",
              borderBottom: "1px solid var(--border)",
              fontSize: 11,
              color: "var(--fg-3)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              background: "var(--bg-sunken)",
            }}
          >
            <span style={{ width: 90 }}>Time</span>
            <span style={{ width: 200 }}>Actor</span>
            <span style={{ width: 200 }}>Action</span>
            <span style={{ flex: 1 }}>Resource</span>
            <span style={{ width: 90 }}>Status</span>
            <span style={{ width: 130 }}>Source IP</span>
            <span style={{ width: 80, textAlign: "right" }} />
          </div>
          {filtered.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", color: "var(--fg-3)", fontSize: 12 }}>
              No events match this filter.
            </div>
          )}
          {filtered.map((e, i) => (
            <EventRow key={e.id} e={e} borderTop={i > 0} onOpen={() => setOpen(e.id)} />
          ))}
        </div>
      </div>

      {opening && <EventDrawer e={opening} all={events} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "ok" | "warn" | "err";
}) {
  const color = tone === "err" ? "var(--err)" : tone === "warn" ? "var(--warn)" : "var(--fg)";
  return (
    <div className="card" style={{ padding: 14 }}>
      <div
        className="muted"
        style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}
      >
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", marginTop: 4, color }}>
        {value}
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
        {sub}
      </div>
    </div>
  );
}

function EventRow({
  e,
  borderTop,
  onOpen,
}: {
  e: AuditEvent;
  borderTop: boolean;
  onOpen: () => void;
}) {
  const ResIcon = I[RESOURCE_ICON[e.resource.kind]] as (p: {
    width?: number;
    height?: number;
    style?: React.CSSProperties;
  }) => React.JSX.Element;
  const project = e.resource.project
    ? PROJECTS.find((p) => p.id === e.resource.project)
    : undefined;
  return (
    <div
      className="row"
      style={{
        padding: "10px 14px",
        borderTop: borderTop ? "1px solid var(--border)" : "none",
        fontSize: 12,
        background: e.anomaly ? "color-mix(in srgb, var(--warn) 6%, transparent)" : "transparent",
      }}
    >
      <span className="mono muted" style={{ width: 90, fontSize: 11 }}>
        {e.ts}
      </span>
      <span style={{ width: 200 }}>
        <ActorChip actor={e.actor} />
      </span>
      <span style={{ width: 200 }}>
        <span className="row gap-2" style={{ alignItems: "center" }}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: ACTION_COLORS[e.action],
            }}
          />
          <span className="mono" style={{ fontSize: 11.5 }}>
            {e.action}
          </span>
        </span>
      </span>
      <span style={{ flex: 1 }}>
        <span className="row gap-2" style={{ alignItems: "center" }}>
          <ResIcon width={11} height={11} style={{ color: "var(--fg-3)" }} />
          <span className="mono" style={{ fontSize: 11.5 }}>
            {e.resource.name}
          </span>
          {project && (
            <span
              className="mono"
              style={{
                fontSize: 9,
                padding: "1px 5px",
                borderRadius: 3,
                background: `color-mix(in srgb, ${project.color} 14%, transparent)`,
                color: project.color,
                border: `1px solid color-mix(in srgb, ${project.color} 28%, transparent)`,
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: 4,
                  height: 4,
                  borderRadius: "50%",
                  background: project.color,
                  marginRight: 4,
                }}
              />
              {project.name}
            </span>
          )}
          {e.anomaly && (
            <span className="badge warn" style={{ fontSize: 9 }}>
              <I.warning width={9} height={9} /> anomaly
            </span>
          )}
        </span>
      </span>
      <span style={{ width: 90 }}>
        <span
          className={`badge ${
            e.status === "success" ? "ok" : e.status === "denied" ? "warn" : "err"
          }`}
        >
          <span className="dot" />
          {e.status}
        </span>
      </span>
      <span className="mono muted" style={{ width: 130, fontSize: 11 }}>
        {e.ip}
      </span>
      <span style={{ width: 80, textAlign: "right" }}>
        <button className="btn ghost sm" onClick={onOpen}>
          Details <I.chev width={10} height={10} />
        </button>
      </span>
    </div>
  );
}

function ActorChip({ actor }: { actor: AuditEvent["actor"] }) {
  const kindBg: Record<ActorKind, string> = {
    human: "var(--bg-overlay)",
    "api-token": "var(--info-bg)",
    system: "color-mix(in srgb, var(--fg-3) 14%, transparent)",
    automation: "color-mix(in srgb, var(--warn) 14%, transparent)",
  };
  const kindFg: Record<ActorKind, string> = {
    human: "var(--fg-3)",
    "api-token": "var(--info)",
    system: "var(--fg-3)",
    automation: "var(--warn)",
  };
  return (
    <span className="row gap-2" style={{ alignItems: "center" }}>
      <span
        style={{
          width: 22,
          height: 22,
          borderRadius: "50%",
          background: "var(--bg-overlay)",
          color: "var(--fg-2)",
          display: "grid",
          placeItems: "center",
          fontSize: 10,
          fontWeight: 600,
        }}
      >
        {actor.initials}
      </span>
      <span
        className="col"
        style={{ gap: 0, alignItems: "flex-start", lineHeight: 1.2, minWidth: 0 }}
      >
        <span style={{ fontSize: 12, fontWeight: 500 }}>{actor.name}</span>
        <span
          className="mono"
          style={{
            fontSize: 9,
            padding: "0 5px",
            borderRadius: 2,
            background: kindBg[actor.kind],
            color: kindFg[actor.kind],
          }}
        >
          {actor.kind}
        </span>
      </span>
    </span>
  );
}

function EventDrawer({
  e,
  all,
  onClose,
}: {
  e: AuditEvent;
  all: AuditEvent[];
  onClose: () => void;
}) {
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const parent = e.parent ? all.find((x) => x.id === e.parent) : undefined;
  const correlated = (e.correlated ?? [])
    .map((id) => all.find((x) => x.id === id))
    .filter(Boolean) as AuditEvent[];

  const fullJson = useMemo(
    () =>
      JSON.stringify(
        {
          id: e.id,
          ts: e.tsAbs,
          actor: e.actor,
          action: e.action,
          resource: e.resource,
          status: e.status,
          ip: e.ip,
          ua: e.ua,
          geo: e.geo,
          sessionId: e.sessionId,
          parent: e.parent,
          correlated: e.correlated,
          request: e.request,
          responseCode: e.responseCode,
          anomaly: e.anomaly,
        },
        null,
        2,
      ),
    [e],
  );

  return (
    <div
      onClick={onClose}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 200,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        justifyContent: "flex-end",
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        onClick={(ev) => ev.stopPropagation()}
        style={{
          width: 480,
          height: "100%",
          background: "var(--bg-elev)",
          borderLeft: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          boxShadow: "var(--shadow-lg)",
        }}
      >
        <div
          className="row gap-2"
          style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: ACTION_COLORS[e.action],
            }}
          />
          <span className="mono" style={{ fontWeight: 600 }}>
            {e.action}
          </span>
          <span className="mono muted" style={{ fontSize: 11 }}>
            {e.id}
          </span>
          <div style={{ flex: 1 }} />
          <button className="btn ghost icon sm" onClick={onClose}>
            <I.close width={13} height={13} />
          </button>
        </div>

        <div className="os-scroll col gap-4" style={{ flex: 1, overflow: "auto", padding: 18 }}>
          {e.anomaly && (
            <div
              className="row gap-2"
              style={{
                padding: "10px 12px",
                background: "color-mix(in srgb, var(--warn) 14%, transparent)",
                border: "1px solid color-mix(in srgb, var(--warn) 30%, transparent)",
                borderRadius: 6,
                fontSize: 12,
                color: "var(--warn)",
              }}
            >
              <I.warning width={12} height={12} />
              <span>{e.anomaly}</span>
            </div>
          )}

          <div>
            <SectionLabel>Actor</SectionLabel>
            <ActorChip actor={e.actor} />
            <KV k="Session" v={e.sessionId} mono />
          </div>

          <div>
            <SectionLabel>When · where</SectionLabel>
            <KV k="Timestamp" v={e.tsAbs} mono />
            <KV k="IP" v={e.ip} mono />
            <KV k="Geo" v={e.geo} />
            <KV k="User-Agent" v={e.ua} mono />
          </div>

          <div>
            <SectionLabel>Response</SectionLabel>
            <KV k="Status" v={`${e.status} (HTTP ${e.responseCode})`} />
          </div>

          {parent && (
            <div>
              <SectionLabel>Parent event</SectionLabel>
              <div className="card" style={{ padding: 8, fontSize: 12 }}>
                <span className="mono">{parent.id}</span>{" "}
                <span className="muted">
                  · {parent.action} · {parent.ts}
                </span>
              </div>
            </div>
          )}

          {correlated.length > 0 && (
            <div>
              <SectionLabel>Correlated events</SectionLabel>
              <div className="col gap-1">
                {correlated.map((c) => (
                  <div key={c.id} className="card" style={{ padding: 8, fontSize: 12 }}>
                    <span className="mono">{c.id}</span>{" "}
                    <span className="muted">
                      · {c.action} · {c.ts}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="row" style={{ marginBottom: 6 }}>
              <SectionLabel>Request payload</SectionLabel>
              <div style={{ flex: 1 }} />
              <button
                className="btn ghost sm"
                onClick={() => setShowRaw((s) => !s)}
                style={{ fontSize: 11 }}
              >
                {showRaw ? "Collapse" : "Expand"}
              </button>
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
                lineHeight: 1.6,
                color: "var(--fg-2)",
                maxHeight: showRaw ? "none" : 120,
                overflow: "auto",
              }}
            >
              {JSON.stringify(e.request ?? {}, null, 2)}
            </pre>
          </div>

          <div>
            <SectionLabel>Full event JSON</SectionLabel>
            <pre
              className="mono"
              style={{
                margin: 0,
                padding: 12,
                background: "var(--bg-sunken)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                fontSize: 10.5,
                lineHeight: 1.6,
                color: "var(--fg-2)",
                maxHeight: 260,
                overflow: "auto",
              }}
            >
              {fullJson}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="muted"
      style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}
    >
      {children}
    </div>
  );
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="row" style={{ padding: "5px 0", fontSize: 12 }}>
      <span className="muted" style={{ width: 100, fontSize: 11 }}>
        {k}
      </span>
      <span
        className={mono ? "mono" : ""}
        style={{ flex: 1, color: "var(--fg-2)", wordBreak: "break-all" }}
      >
        {v}
      </span>
    </div>
  );
}
