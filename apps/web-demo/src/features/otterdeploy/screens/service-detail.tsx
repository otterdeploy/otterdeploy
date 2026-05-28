// Per-service detail screen — Build & Deploy, Variables, Networking, Scaling, Metrics, Logs, Settings.
// Bridges the gap between a service in the graph/sidebar and its full configuration.

import { useMemo, useState } from "react";

import { DatabaseLogo } from "../brand/database-logo";
import { I, type IconKey } from "../icons";
import {
  BUILDERS,
  ENV_OVERVIEW_KEYS,
  SERVICES,
  type Env,
  type Service,
} from "../data";
import {
  Field,
  Switch3,
  SettingRow,
  SectionH,
  BuilderConfig,
} from "../components/form";
import {
  TerminalWorkspace,
  shellTarget,
  dbTarget,
} from "../components/terminal-workspace";
import type { TerminalSession } from "../components/terminal-workspace";
import { Logs } from "./logs";
import type { Tab } from "../app";

type SubTab =
  | "overview"
  | "build"
  | "variables"
  | "networking"
  | "scaling"
  | "metrics"
  | "logs"
  | "terminal"
  | "settings";

type IconComp = (p: {
  width?: number;
  height?: number;
  style?: React.CSSProperties;
}) => React.JSX.Element;

export function ServiceDetail({
  serviceId,
  env,
  onTab,
  onOpenLogs,
}: {
  serviceId: string;
  env: Env;
  onTab: (t: Tab | string) => void;
  onOpenLogs?: (id: string) => void;
}) {
  const service = SERVICES.find((s) => s.id === serviceId);
  const [sub, setSub] = useState<SubTab>("overview");

  if (!service) {
    return (
      <div
        style={{
          flex: 1,
          display: "grid",
          placeItems: "center",
          color: "var(--fg-3)",
        }}
      >
        Service not found ·{" "}
        <button
          className="btn sm"
          onClick={() => onTab("graph")}
          style={{ marginLeft: 8 }}
        >
          Back to graph
        </button>
      </div>
    );
  }

  const isDb = service.kind === "database";
  const tabs: Array<[SubTab, string, IconComp]> = isDb
    ? [
        ["overview", "Overview", I.home],
        ["variables", "Variables", I.env],
        ["networking", "Networking", I.globe],
        ["metrics", "Metrics", I.metrics],
        ["logs", "Logs", I.log],
        ["terminal", "Terminal", I.bolt],
        ["settings", "Settings", I.settings],
      ]
    : [
        ["overview", "Overview", I.home],
        ["build", "Build & deploy", I.bolt],
        ["variables", "Variables", I.env],
        ["networking", "Networking", I.globe],
        ["scaling", "Scaling", I.scale],
        ["metrics", "Metrics", I.metrics],
        ["logs", "Logs", I.log],
        ["terminal", "Terminal", I.bolt],
        ["settings", "Settings", I.settings],
      ];

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Service header */}
      <div className="row" style={{ padding: "14px 22px 0", gap: 12 }}>
        <button
          className="btn ghost icon sm"
          onClick={() => onTab("graph")}
          title="Back to graph"
        >
          <I.chev
            width={11}
            height={11}
            style={{ transform: "rotate(180deg)" }}
          />
        </button>
        <div className="row gap-2" style={{ alignItems: "center" }}>
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 6,
              background: "var(--bg-overlay)",
              border: "1px solid var(--border)",
              display: "grid",
              placeItems: "center",
            }}
          >
            {isDb ? (
              <DatabaseLogo
                value={`${service.name} ${service.image}`}
                size={16}
              />
            ) : (
              <I.service width={14} height={14} />
            )}
          </div>
          <div>
            <div className="row gap-2">
              <span className="mono" style={{ fontWeight: 600, fontSize: 16 }}>
                {service.name}
              </span>
              <span
                className={`badge ${
                  service.status === "healthy"
                    ? "ok"
                    : service.status === "degraded"
                      ? "warn"
                      : "err"
                }`}
              >
                <span className="dot" />
                {service.status}
              </span>
              <span className="badge">
                <span
                  className={`os-env-dot ${env === "production" ? "" : env === "staging" ? "staging" : "preview"}`}
                />
                {env}
              </span>
            </div>
            <div className="muted mono" style={{ fontSize: 11, marginTop: 2 }}>
              {isDb
                ? `${service.kind} · ${service.image}@${service.version ?? ""}`
                : `${service.replicas || 1} replica${(service.replicas || 1) > 1 ? "s" : ""} · port ${service.port ?? "—"} · ${
                    service.commit ? service.commit.slice(0, 7) : ""
                  }`}
            </div>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        {!isDb && (
          <>
            <button className="btn">
              <I.refresh width={11} height={11} /> Restart
            </button>
            <button className="btn primary">
              <I.rocket width={11} height={11} /> Deploy
            </button>
          </>
        )}
      </div>

      {/* Sub-tabs */}
      <div
        className="row"
        style={{
          borderBottom: "1px solid var(--border)",
          padding: "12px 22px 0",
          marginTop: 12,
          gap: 0,
          overflowX: "auto",
        }}
      >
        {tabs.map(([id, lab, Ic]) => (
          <button
            key={id}
            className="os-envtab"
            data-active={sub === id}
            onClick={() => setSub(id)}
            style={{ height: 34, borderRight: 0 }}
          >
            <Ic width={12} height={12} style={{ opacity: 0.7 }} />{" "}
            <span>{lab}</span>
            <span className="os-envtab-underline" />
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: "auto" }} className="os-scroll">
        {sub === "overview" && (
          <SD_Overview
            service={service}
            setSub={setSub}
            onOpenLogs={onOpenLogs}
          />
        )}
        {sub === "build" && <SD_Build service={service} />}
        {sub === "variables" && <SD_Variables service={service} env={env} />}
        {sub === "networking" && <SD_Networking service={service} />}
        {sub === "scaling" && <SD_Scaling service={service} />}
        {sub === "metrics" && <SD_Metrics service={service} />}
        {sub === "logs" && <SD_Logs service={service} />}
        {sub === "terminal" && <SD_Terminal service={service} />}
        {sub === "settings" && <SD_Settings service={service} onTab={onTab} />}
      </div>
    </div>
  );
}

// ────── Overview ──────
function SD_Overview({
  service,
  setSub,
  onOpenLogs,
}: {
  service: Service;
  setSub: (s: SubTab) => void;
  onOpenLogs?: (id: string) => void;
}) {
  const isDb = service.kind === "database";
  return (
    <div style={{ padding: 22, maxWidth: 1100, margin: "0 auto" }}>
      {/* stat row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
        }}
      >
        <Stat2
          label="status"
          value={service.status}
          accent={
            service.status === "healthy"
              ? "ok"
              : service.status === "degraded"
                ? "warn"
                : "err"
          }
        />
        <Stat2
          label={isDb ? "storage" : "CPU · mem"}
          value={
            isDb && service.storage
              ? `${service.storage.used}/${service.storage.total} ${service.storage.unit}`
              : `${Math.round(service.cpu * 100)}% · ${Math.round(service.mem * 100)}%`
          }
        />
        <Stat2
          label={isDb ? "version" : "replicas"}
          value={
            isDb ? (service.version ?? "—") : `${service.replicas || 1} running`
          }
        />
        <Stat2 label="last deploy" value={service.lastDeploy || "—"} />
      </div>

      {/* quick actions to other sub-tabs */}
      {!isDb && (
        <>
          <div style={{ height: 18 }} />
          <SectionH
            title="Configuration"
            sub="Tap a card to jump to that section"
          />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              marginTop: 10,
            }}
          >
            <NavCard
              onClick={() => setSub("build")}
              icon={I.bolt}
              title="Build & deploy"
              detail={`Railpack · auto-deploy on push to main · last build 1m 12s`}
            />
            <NavCard
              onClick={() => setSub("scaling")}
              icon={I.scale}
              title="Scaling"
              detail={`${service.replicas || 1} replicas · 0.5 vCPU · 512 MB · rolling updates`}
            />
            <NavCard
              onClick={() => setSub("networking")}
              icon={I.globe}
              title="Networking"
              detail={`${service.domain || "internal only"} · port ${service.port ?? "—"} · TLS via Caddy`}
            />
            <NavCard
              onClick={() => setSub("variables")}
              icon={I.env}
              title="Variables"
              detail={`17 keys · synced from Infisical · 2m ago`}
            />
          </div>
        </>
      )}

      {isDb && (
        <>
          <div style={{ height: 18 }} />
          <SectionH title="Connection" />
          <div className="card" style={{ padding: 16, marginTop: 10 }}>
            <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
              Connection string · injected as{" "}
              <span className="mono" style={{ color: "var(--fg-2)" }}>
                DATABASE_URL
              </span>
            </div>
            <div className="row gap-2">
              <code
                className="mono"
                style={{
                  flex: 1,
                  padding: 8,
                  background: "var(--bg-sunken)",
                  borderRadius: 6,
                  fontSize: 12,
                  border: "1px solid var(--border)",
                }}
              >
                {service.image.startsWith("postgres")
                  ? `postgres://helio:••••••@${service.name}.helio.internal:5432/helio`
                  : `redis://${service.name}.helio.internal:6379`}
              </code>
              <button className="btn">
                <I.copy width={11} height={11} /> Copy
              </button>
            </div>
          </div>
        </>
      )}

      <div style={{ height: 18 }} />
      <SectionH title="Recent activity" />
      <div className="card" style={{ marginTop: 10, overflow: "hidden" }}>
        {(
          [
            {
              ic: I.rocket,
              t: `Deployed ${service.commit ? service.commit.slice(0, 7) : "latest"}`,
              sub: service.commitMsg || "image rebuild",
              when: service.lastDeploy || "—",
            },
            {
              ic: I.check,
              t: "Health check passing",
              sub: "/health · 18ms · 200",
              when: "20s ago",
            },
            {
              ic: I.env,
              t: "Variables synced from Infisical",
              sub: "17 keys · no changes",
              when: "2m ago",
            },
            {
              ic: I.scale,
              t: "Replica added",
              sub: "autoscaler · CPU > 60% target",
              when: "14m ago",
            },
          ] as const
        ).map((a, i) => {
          const Ic = a.ic;
          return (
            <div
              key={i}
              className="row"
              style={{
                padding: "10px 14px",
                borderTop: i > 0 ? "1px solid var(--border)" : "none",
                fontSize: 12,
              }}
            >
              <span style={{ width: 26, color: "var(--fg-3)" }}>
                <Ic width={13} height={13} />
              </span>
              <span style={{ flex: 1 }}>
                <div style={{ fontWeight: 500 }}>{a.t}</div>
                <div className="muted mono" style={{ fontSize: 11 }}>
                  {a.sub}
                </div>
              </span>
              <span className="muted mono" style={{ fontSize: 11 }}>
                {a.when}
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ height: 12 }} />
      <button className="btn" onClick={() => onOpenLogs?.(service.id)}>
        <I.log width={11} height={11} /> Open logs for {service.name}
      </button>
    </div>
  );
}

function Stat2({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "ok" | "warn" | "err";
}) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div
        className="muted"
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </div>
      <div
        className="mono"
        style={{
          fontSize: 18,
          fontWeight: 500,
          marginTop: 4,
          color:
            accent === "ok"
              ? "var(--ok)"
              : accent === "warn"
                ? "var(--warn)"
                : accent === "err"
                  ? "var(--err)"
                  : "var(--fg)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function NavCard({
  onClick,
  icon: Ic,
  title,
  detail,
}: {
  onClick: () => void;
  icon: IconComp;
  title: string;
  detail: string;
}) {
  return (
    <button
      onClick={onClick}
      className="card"
      style={{
        padding: 14,
        textAlign: "left",
        cursor: "pointer",
        font: "inherit",
        color: "var(--fg)",
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: 6,
          background: "var(--bg-sunken)",
          border: "1px solid var(--border)",
          display: "grid",
          placeItems: "center",
          color: "var(--fg-2)",
        }}
      >
        <Ic width={14} height={14} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500, fontSize: 13 }}>{title}</div>
        <div
          className="muted mono"
          style={{
            fontSize: 11,
            marginTop: 2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {detail}
        </div>
      </div>
      <I.chev width={12} height={12} style={{ color: "var(--fg-4)" }} />
    </button>
  );
}

// ────── Build & Deploy ──────
function SD_Build({ service }: { service: Service }) {
  const [builderId, setBuilderId] = useState("railpack");
  return (
    <div style={{ padding: 22, maxWidth: 1000, margin: "0 auto" }}>
      <SectionH
        title="Source"
        sub={`paperhouse/helio · main · apps/${service.name}`}
      />
      <div className="card" style={{ padding: 16, marginTop: 10 }}>
        <div className="row gap-3">
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 6,
              background: "var(--bg-sunken)",
              border: "1px solid var(--border)",
              display: "grid",
              placeItems: "center",
            }}
          >
            <I.branch width={14} height={14} />
          </div>
          <div style={{ flex: 1 }}>
            <div className="mono" style={{ fontSize: 13, fontWeight: 500 }}>
              github.com/paperhouse/helio
            </div>
            <div className="muted mono" style={{ fontSize: 11 }}>
              branch: main · root: apps/{service.name} ·{" "}
              {service.commit ? service.commit.slice(0, 7) : "no commit"} ·{" "}
              {service.author || "unknown"}
            </div>
          </div>
          <button className="btn">
            <I.link width={11} height={11} /> Reconnect
          </button>
        </div>
      </div>

      <div style={{ height: 18 }} />
      <SectionH title="Build provider" />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 10,
          marginTop: 10,
          marginBottom: 18,
        }}
      >
        {BUILDERS.map((b) => {
          const key =
            (b.icon as IconKey) in I ? (b.icon as IconKey) : ("doc" as IconKey);
          const Ic = I[key];
          return (
            <button
              key={b.id}
              onClick={() => setBuilderId(b.id)}
              className={`os-builder ${builderId === b.id ? "active" : ""}`}
            >
              {b.popular && <span className="os-builder-pop">popular</span>}
              <div className="row gap-2">
                <div className="os-builder-icon">
                  <Ic width={14} height={14} />
                </div>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{b.name}</span>
              </div>
              <div
                className="muted"
                style={{ fontSize: 11, marginTop: 4, lineHeight: 1.4 }}
              >
                {b.sub}
              </div>
            </button>
          );
        })}
      </div>

      <BuilderConfig builderId={builderId} service={service.name} />

      <div style={{ height: 18 }} />
      <SectionH title="Deploy" />
      <div className="card" style={{ padding: 16, marginTop: 10 }}>
        <Field label="Deploy command">
          <input
            className="input mono"
            defaultValue={
              service.name === "web"
                ? "pnpm start"
                : service.name === "api"
                  ? "node dist/server.js"
                  : "celery -A app worker"
            }
          />
        </Field>
        <div style={{ height: 10 }} />
        <Field label="Watch paths">
          <input
            className="input mono"
            defaultValue={`apps/${service.name}/**, packages/shared/**`}
          />
        </Field>
        <div style={{ height: 12 }} />
        <SettingRow
          label="Auto-deploy on push to main"
          defaultOn
          sub="Trigger a build whenever the watched branch updates"
        />
        <SettingRow
          label="Block deploy on failed health check"
          defaultOn
          sub="Keep old replicas running if /health fails"
        />
        <SettingRow
          label="Zero-downtime rolling deploy"
          defaultOn
          sub="Drain old replicas only after new ones report ready"
        />
      </div>
    </div>
  );
}

// ────── Variables (scoped to this service) ──────
function SD_Variables({ service, env }: { service: Service; env: Env }) {
  const [revealAll, setRevealAll] = useState(false);
  const rows = ENV_OVERVIEW_KEYS.filter((r) => r.status[env] !== "missing")
    .slice(0, 12)
    .map((r) => ({
      ...r,
      value: r.secret
        ? "••••••••••••••••••••••"
        : r.k === "DATABASE_URL"
          ? `postgres://helio:•••@${env}-postgres:5432/helio`
          : "value",
    }));

  return (
    <div style={{ padding: 22, maxWidth: 1100, margin: "0 auto" }}>
      <div className="row gap-2" style={{ marginBottom: 14 }}>
        <SectionH
          title="Variables"
          sub={`Injected into ${service.name} at runtime · ${env}`}
        />
        <div style={{ flex: 1 }} />
        <button
          className="btn ghost icon"
          onClick={() => setRevealAll((r) => !r)}
        >
          <I.eye width={13} height={13} />
        </button>
        <button className="btn">
          <I.upload width={11} height={11} /> Import .env
        </button>
        <button className="btn primary">
          <I.plus width={11} height={11} /> Add variable
        </button>
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        <div className="os-pe-head">
          <span style={{ flex: 1 }}>Key</span>
          <span
            style={{
              flex: 2,
              borderLeft: "1px solid var(--border)",
              paddingLeft: 12,
            }}
          >
            Value
          </span>
          <span style={{ width: 80 }}>Source</span>
          <span style={{ width: 60 }} />
        </div>
        {rows.map((r) => (
          <div key={r.k} className="os-pe-row">
            <span
              style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}
            >
              <I.key width={11} height={11} style={{ color: "var(--fg-3)" }} />
              <span className="mono" style={{ fontSize: 12, fontWeight: 500 }}>
                {r.k}
              </span>
            </span>
            <span
              style={{
                flex: 2,
                borderLeft: "1px solid var(--border)",
                paddingLeft: 12,
              }}
            >
              <span
                className="mono"
                style={{
                  fontSize: 12,
                  color: r.secret && !revealAll ? "var(--fg-3)" : "var(--fg-2)",
                }}
              >
                {r.secret && !revealAll ? "••••••••••••••••••••••" : r.value}
              </span>
            </span>
            <span style={{ width: 80, fontSize: 11 }}>
              {r.k === "DATABASE_URL" ? (
                <span className="badge">
                  <I.link width={9} height={9} />
                  linked
                </span>
              ) : (
                <span className="muted">manual</span>
              )}
            </span>
            <span style={{ width: 60, textAlign: "right" }}>
              <button className="btn ghost icon sm">
                <I.more width={11} height={11} />
              </button>
            </span>
          </div>
        ))}
      </div>

      <div className="muted" style={{ fontSize: 11, marginTop: 10 }}>
        Variables defined at the project level apply to all services.
        Service-level overrides take precedence. Manage project-wide variables
        in the <span style={{ color: "var(--fg-2)" }}>Variables</span> sidebar
        tab.
      </div>
    </div>
  );
}

// ────── Networking (scoped) ──────
function SD_Networking({ service }: { service: Service }) {
  const [publicEnabled, setPublicEnabled] = useState(!!service.domain);
  const [host, setHost] = useState(
    service.domain || `${service.name}.helio.so`,
  );
  const [port, setPort] = useState<number>(service.port ?? 3000);

  return (
    <div style={{ padding: 22, maxWidth: 1000, margin: "0 auto" }}>
      <SectionH
        title="Public access"
        sub="Expose this service through the Caddy edge proxy"
      />
      <div className="card" style={{ padding: 16, marginTop: 10 }}>
        <div className="row gap-3">
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>Public route</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              When enabled, requests to{" "}
              <span className="mono" style={{ color: "var(--fg-2)" }}>
                {host}
              </span>{" "}
              are proxied to{" "}
              <span className="mono" style={{ color: "var(--fg-2)" }}>
                {service.name}.helio.internal:{port}
              </span>
            </div>
          </div>
          <Switch3 on={publicEnabled} onChange={setPublicEnabled} />
        </div>
        {publicEnabled && (
          <>
            <div style={{ height: 14 }} />
            <Field label="Hostname">
              <input
                className="input mono"
                value={host}
                onChange={(e) => setHost(e.target.value)}
              />
            </Field>
            <div style={{ height: 10 }} />
            <div className="row gap-2">
              <span className="badge ok">
                <span className="dot" />
                letsencrypt cert active
              </span>
              <span className="badge">
                <I.lock width={9} height={9} />
                HSTS
              </span>
              <span className="badge">HTTP/3</span>
            </div>
          </>
        )}
      </div>

      <div style={{ height: 18 }} />
      <SectionH title="Internal address" />
      <div className="card" style={{ padding: 16, marginTop: 10 }}>
        <div className="row gap-2">
          <code
            className="mono"
            style={{
              flex: 1,
              padding: 8,
              background: "var(--bg-sunken)",
              borderRadius: 6,
              fontSize: 12,
              border: "1px solid var(--border)",
            }}
          >
            {service.name}.helio.internal:{port}
          </code>
          <button className="btn">
            <I.copy width={11} height={11} /> Copy
          </button>
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
          Reachable from any service in the project — no auth, no TLS. Use the
          public route for external traffic.
        </div>
      </div>

      <div style={{ height: 18 }} />
      <SectionH title="Ports" />
      <div className="card" style={{ padding: 16, marginTop: 10 }}>
        <div className="row gap-2">
          <Field label="Container port">
            <input
              className="input mono"
              type="number"
              value={port}
              onChange={(e) => setPort(+e.target.value || 80)}
              style={{ width: 120 }}
            />
          </Field>
          <div style={{ width: 14 }} />
          <Field label="Health check path">
            <input
              className="input mono"
              defaultValue="/health"
              style={{ width: 220 }}
            />
          </Field>
        </div>
        <div style={{ height: 12 }} />
        <SettingRow
          label="Forward client IP (X-Forwarded-For)"
          defaultOn
          sub="Pass real client IP through to this service"
        />
        <SettingRow
          label="WebSocket upgrade"
          defaultOn
          sub="Allow ws:// connection upgrades"
        />
        <SettingRow
          label="Compression at edge (zstd, gzip)"
          defaultOn
          sub="Encode responses on the wire"
        />
      </div>

      <div style={{ height: 14 }} />
      <div className="muted" style={{ fontSize: 11 }}>
        Want full Caddyfile control? Edit it in{" "}
        <span style={{ color: "var(--fg-2)" }}>Networking → Caddyfile</span>.
      </div>
    </div>
  );
}

// ────── Scaling (scoped) ──────
function SD_Scaling({ service }: { service: Service }) {
  const [replicas, setReplicas] = useState<number>(service.replicas || 2);
  const [cpu, setCpu] = useState(0.5);
  const [mem, setMem] = useState(512);

  return (
    <div style={{ padding: 22, maxWidth: 1000, margin: "0 auto" }}>
      <SectionH
        title="Replicas"
        sub="Number of running copies · changes apply via rolling update"
      />
      <div className="card" style={{ padding: 16, marginTop: 10 }}>
        <div className="row gap-2">
          <button
            className="btn ghost icon"
            onClick={() => setReplicas((r) => Math.max(1, r - 1))}
          >
            <I.x width={11} height={11} />
          </button>
          <input
            className="input mono"
            type="number"
            value={replicas}
            onChange={(e) => setReplicas(+e.target.value || 1)}
            style={{ width: 80, textAlign: "center", fontSize: 18, height: 36 }}
          />
          <button
            className="btn ghost icon"
            onClick={() => setReplicas((r) => r + 1)}
          >
            <I.plus width={11} height={11} />
          </button>
          <div style={{ flex: 1 }} />
          <span className="mono muted" style={{ fontSize: 11 }}>
            across {Math.min(replicas, 3)} node{replicas > 1 ? "s" : ""}
          </span>
        </div>
        <div
          className="row gap-1"
          style={{
            marginTop: 14,
            padding: 10,
            background: "var(--bg-sunken)",
            borderRadius: 6,
            border: "1px solid var(--border)",
          }}
        >
          {[0, 1, 2].map((n) => {
            const onThisNode = Math.ceil((replicas - n) / 3);
            const has = onThisNode > 0;
            return (
              <div
                key={n}
                style={{
                  flex: 1,
                  padding: 8,
                  borderRadius: 4,
                  background: has ? "var(--bg-elev)" : "transparent",
                  border: "1px solid var(--border)",
                }}
              >
                <div
                  className="mono"
                  style={{ fontSize: 10, color: "var(--fg-3)" }}
                >
                  node-{n + 1}
                </div>
                <div
                  className="row gap-1"
                  style={{ marginTop: 6, flexWrap: "wrap" }}
                >
                  {Array.from({ length: Math.max(0, onThisNode) }).map(
                    (_, i) => (
                      <span
                        key={i}
                        style={{
                          display: "inline-block",
                          width: 12,
                          height: 12,
                          borderRadius: 3,
                          background: "var(--ok)",
                        }}
                      />
                    ),
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ height: 18 }} />
      <SectionH title="Resources (per replica)" />
      <div className="card" style={{ padding: 16, marginTop: 10 }}>
        <Field label={`CPU limit · ${cpu} vCPU`}>
          <input
            type="range"
            min="0.1"
            max="4"
            step="0.1"
            value={cpu}
            onChange={(e) => setCpu(+e.target.value)}
            style={{ width: "100%" }}
          />
        </Field>
        <div style={{ height: 8 }} />
        <Field
          label={`Memory limit · ${mem >= 1024 ? (mem / 1024).toFixed(1) + " GB" : mem + " MB"}`}
        >
          <input
            type="range"
            min="128"
            max="4096"
            step="128"
            value={mem}
            onChange={(e) => setMem(+e.target.value)}
            style={{ width: "100%" }}
          />
        </Field>
        <div
          className="row gap-3"
          style={{
            padding: 10,
            background: "var(--bg-sunken)",
            borderRadius: 6,
            border: "1px solid var(--border)",
            marginTop: 12,
          }}
        >
          <div>
            <div
              className="muted"
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              service total
            </div>
            <div className="mono" style={{ fontSize: 14, fontWeight: 500 }}>
              {(cpu * replicas).toFixed(1)} vCPU ·{" "}
              {((mem * replicas) / 1024).toFixed(1)} GB
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <span className="badge ok">
            <span className="dot" />
            fits cluster capacity
          </span>
        </div>
      </div>

      <div style={{ height: 18 }} />
      <SectionH title="Autoscaling" />
      <div className="card" style={{ padding: 16, marginTop: 10 }}>
        <SettingRow
          label="Enable autoscaling"
          sub="Add/remove replicas based on the chosen metric"
        />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 10,
            marginTop: 12,
          }}
        >
          <Field label="Metric">
            <select className="input">
              <option>CPU utilization</option>
              <option>Memory utilization</option>
              <option>Request latency (p95)</option>
            </select>
          </Field>
          <Field label="Target value">
            <input className="input mono" defaultValue="60%" />
          </Field>
          <Field label="Min – Max">
            <div className="row gap-2">
              <input
                className="input mono"
                defaultValue={replicas}
                style={{ width: 60 }}
              />
              <span className="muted">–</span>
              <input
                className="input mono"
                defaultValue={replicas * 5}
                style={{ width: 60 }}
              />
            </div>
          </Field>
        </div>
      </div>
    </div>
  );
}

// ────── Metrics (scoped) ──────
function SD_Metrics({ service }: { service: Service }) {
  return (
    <div style={{ padding: 22, maxWidth: 1100, margin: "0 auto" }}>
      <SectionH
        title={`${service.name} metrics`}
        sub="Last 1h · 5s resolution"
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 12,
          marginTop: 12,
        }}
      >
        {[
          { label: "requests / sec", value: "1.4k" },
          { label: "p95 latency", value: "142ms" },
          { label: "CPU usage", value: `${Math.round(service.cpu * 100)}%` },
          { label: "memory usage", value: `${Math.round(service.mem * 100)}%` },
          { label: "error rate", value: "0.04%" },
          { label: "concurrency", value: "24" },
        ].map((m, i) => (
          <div key={i} className="card" style={{ padding: 14 }}>
            <div
              className="muted"
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              {m.label}
            </div>
            <div
              className="mono"
              style={{ fontSize: 22, fontWeight: 500, marginTop: 4 }}
            >
              {m.value}
            </div>
            <Spark seed={i + service.name.length} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Spark({ seed = 1 }: { seed?: number }) {
  const pts = useMemo(() => {
    // Seeded RNG for stable visuals.
    let s = seed * 9301 + 49297;
    const rand = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    const arr: number[] = [];
    let v = 50;
    for (let i = 0; i < 40; i++) {
      v += Math.sin(i * 0.7 + seed) * 8 + (rand() - 0.5) * 6;
      v = Math.max(8, Math.min(92, v));
      arr.push(v);
    }
    return arr;
  }, [seed]);
  const path = pts
    .map(
      (v, i) =>
        `${i === 0 ? "M" : "L"} ${(i / (pts.length - 1)) * 280} ${50 - v * 0.4}`,
    )
    .join(" ");
  return (
    <svg
      viewBox="0 0 280 50"
      style={{ width: "100%", height: 50, marginTop: 8 }}
    >
      <path d={path} stroke="var(--fg-2)" strokeWidth="1.2" fill="none" />
    </svg>
  );
}

// ────── Logs (scoped) ──────
function SD_Logs({ service }: { service: Service }) {
  return <Logs target={service.id} />;
}

// ────── Terminal (docker exec / db console) ──────
function SD_Terminal({ service }: { service: Service }) {
  const isDb = service.kind === "database";
  const initial: TerminalSession[] = useMemo(() => {
    if (isDb) {
      const kind = service.image.startsWith("postgres")
        ? ("psql" as const)
        : ("redis" as const);
      return [
        {
          id: `${kind}:${service.id}`,
          kind,
          title: service.name,
          subtitle: kind,
          projectTags: service.project ? [service.project] : undefined,
          target: dbTarget(service.name, kind),
        },
      ];
    }
    // Compute service: pre-seed one tab per replica (up to 4) so the user can switch
    // between containers instantly. Extras are still available via the "+" picker.
    const n = Math.min(service.replicas || 1, 4);
    return Array.from({ length: n }, (_, i) => {
      const replicaId = `r${i + 1}`;
      const replicaName = `r${i + 1}`;
      return {
        id: `shell:${service.id}:${replicaId}`,
        kind: "shell" as const,
        title: service.name,
        subtitle: replicaName,
        projectTags: service.project ? [service.project] : undefined,
        target: shellTarget(service.name, replicaId, replicaName),
      };
    });
  }, [service, isDb]);

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <TerminalWorkspace key={service.id} initial={initial} embedded />
    </div>
  );
}

// ────── Settings (scoped — danger zone for this service) ──────
function SD_Settings({
  service,
  onTab,
}: {
  service: Service;
  onTab: (t: Tab | string) => void;
}) {
  return (
    <div style={{ padding: 22, maxWidth: 760, margin: "0 auto" }}>
      <SectionH title="General" />
      <div className="card" style={{ padding: 16, marginTop: 10 }}>
        <Field label="Service name">
          <input className="input mono" defaultValue={service.name} />
        </Field>
        <div style={{ height: 10 }} />
        <Field label="Description">
          <input className="input" placeholder="What does this service do?" />
        </Field>
      </div>

      <div style={{ height: 18 }} />
      <SectionH title="Health checks" />
      <div className="card" style={{ padding: 16, marginTop: 10 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1fr",
            gap: 10,
          }}
        >
          <Field label="Path">
            <input className="input mono" defaultValue="/health" />
          </Field>
          <Field label="Interval">
            <input className="input mono" defaultValue="10s" />
          </Field>
          <Field label="Timeout">
            <input className="input mono" defaultValue="3s" />
          </Field>
        </div>
        <div style={{ height: 10 }} />
        <SettingRow
          label="Restart unhealthy replicas"
          defaultOn
          sub="After 3 consecutive failures, replace the replica"
        />
      </div>

      <div style={{ height: 18 }} />
      <SectionH title="Danger zone" sub="Per-service destructive actions" />
      <div
        className="card"
        style={{ padding: 16, marginTop: 10, borderColor: "var(--err)" }}
      >
        <div className="row gap-3">
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>Pause service</div>
            <div className="muted" style={{ fontSize: 12 }}>
              Stop all replicas; config is preserved.
            </div>
          </div>
          <button className="btn">Pause</button>
        </div>
        <div
          className="row gap-3"
          style={{
            marginTop: 12,
            paddingTop: 12,
            borderTop: "1px solid var(--border)",
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>Delete service</div>
            <div className="muted" style={{ fontSize: 12 }}>
              Tear down replicas, revoke certs, drop volumes. Cannot be undone.
            </div>
          </div>
          <button
            className="btn"
            style={{
              background: "var(--err-bg)",
              color: "var(--err)",
              borderColor: "var(--err)",
            }}
            onClick={() => onTab("graph")}
          >
            <I.trash width={11} height={11} /> Delete
          </button>
        </div>
      </div>
    </div>
  );
}
