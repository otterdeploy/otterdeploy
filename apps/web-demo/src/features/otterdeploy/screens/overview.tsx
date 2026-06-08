import { DatabaseLogo } from "@/components/brand/database-logo";
import { I } from "../icons";
import { DEPLOYMENTS, SERVICES, type Env, type Service } from "../data";
import { StatusBadge } from "../components/status-badge";

export function Overview(_props: { env: Env }) {
  const services = SERVICES.filter((s) => s.kind === "service");
  const dbs = SERVICES.filter((s) => s.kind === "database");
  return (
    <div
      className="os-scroll"
      style={{ flex: 1, overflow: "auto", padding: 24 }}
    >
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div className="row" style={{ marginBottom: 20 }}>
          <div>
            <div
              style={{
                fontSize: 26,
                fontWeight: 600,
                letterSpacing: "-0.02em",
              }}
            >
              helio
            </div>
            <div className="muted" style={{ fontSize: 13 }}>
              Internal SaaS · self-hosted on rack-2 · 5 services, 2 databases
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <div className="row gap-2">
            <span className="badge ok">
              <span className="dot" />
              all systems normal
            </span>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 12,
            marginBottom: 24,
          }}
        >
          <Stat label="Services" value="6" sub="5 healthy · 1 degraded" />
          <Stat
            label="Deploys / 24h"
            value="14"
            sub="2 failed · 1 rolled back"
          />
          <Stat label="Total RPS" value="1.2k" sub="+18% vs yesterday" />
          <Stat label="Compute" value="6.4 vCPU" sub="of 16 allocated" />
        </div>

        <SectionH title="Services" sub="Compute units in this project" />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: 12,
            marginBottom: 24,
          }}
        >
          {services.map((s) => (
            <ServiceTile key={s.id} s={s} />
          ))}
        </div>

        <SectionH title="Datastores" />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: 12,
            marginBottom: 24,
          }}
        >
          {dbs.map((s) => (
            <DBTile key={s.id} s={s} />
          ))}
        </div>

        <SectionH title="Recent activity" />
        <div className="card" style={{ overflow: "hidden" }}>
          {DEPLOYMENTS.slice(0, 6).map((d, i) => (
            <div
              key={d.id}
              className="row gap-3"
              style={{
                padding: "10px 14px",
                borderTop: i === 0 ? "none" : "1px solid var(--border)",
                fontSize: 13,
              }}
            >
              <StatusBadge status={d.status} />
              <span className="mono" style={{ color: "var(--fg-2)" }}>
                {d.service}
              </span>
              <span style={{ color: "var(--fg-3)" }}>·</span>
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {d.msg}
              </span>
              <span className="mono muted" style={{ fontSize: 12 }}>
                {d.commit}
              </span>
              <span
                className="muted"
                style={{ fontSize: 12, width: 80, textAlign: "right" }}
              >
                {d.when}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SectionH({ title, sub }: { title: string; sub?: string }) {
  return (
    <div
      style={{
        marginBottom: 10,
        display: "flex",
        alignItems: "baseline",
        gap: 10,
      }}
    >
      <h3
        style={{
          margin: 0,
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: "0.01em",
        }}
      >
        {title}
      </h3>
      {sub && (
        <span className="muted" style={{ fontSize: 12 }}>
          {sub}
        </span>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div
        className="muted"
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: "-0.02em",
          marginTop: 4,
        }}
      >
        {value}
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
        {sub}
      </div>
    </div>
  );
}

function ServiceTile({ s }: { s: Service }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="row gap-2">
        <I.service width={14} height={14} style={{ color: "var(--fg-3)" }} />
        <span className="mono" style={{ fontWeight: 500 }}>
          {s.name}
        </span>
        <div style={{ flex: 1 }} />
        <StatusBadge status={s.status} />
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
        {s.framework} · {s.replicas} replicas
      </div>
      <div className="row gap-3" style={{ marginTop: 12 }}>
        <Bar label="cpu" v={s.cpu} />
        <Bar label="mem" v={s.mem} />
      </div>
      {s.commitMsg && (
        <div
          className="mono"
          style={{
            fontSize: 11,
            color: "var(--fg-3)",
            marginTop: 12,
            paddingTop: 10,
            borderTop: "1px solid var(--border)",
          }}
        >
          <span style={{ color: "var(--fg-2)" }}>{s.commit}</span> {s.commitMsg}{" "}
          · {s.lastDeploy}
        </div>
      )}
    </div>
  );
}

function DBTile({ s }: { s: Service }) {
  const used = s.storage ? (s.storage.used / s.storage.total) * 100 : 0;
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="row gap-2">
        <DatabaseLogo
          value={`${s.name} ${s.image}`}
          size={14}
          color="var(--fg-3)"
        />
        <span className="mono" style={{ fontWeight: 500 }}>
          {s.name}
        </span>
        <span className="muted mono" style={{ fontSize: 11 }}>
          {s.version}
        </span>
        <div style={{ flex: 1 }} />
        <StatusBadge status={s.status} />
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
        port {s.port}
      </div>
      {s.storage && (
        <div style={{ marginTop: 12 }}>
          <div
            className="row"
            style={{ fontSize: 11, color: "var(--fg-3)", marginBottom: 4 }}
          >
            <span>storage</span>
            <div style={{ flex: 1 }} />
            <span className="mono">
              {s.storage.used} / {s.storage.total} {s.storage.unit}
            </span>
          </div>
          <div
            style={{
              height: 4,
              background: "var(--bg-overlay)",
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${used}%`,
                height: "100%",
                background: "var(--fg-2)",
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Bar({ label, v }: { label: string; v: number }) {
  const pct = Math.round(v * 100);
  return (
    <div style={{ flex: 1 }}>
      <div
        className="row"
        style={{ fontSize: 11, color: "var(--fg-3)", marginBottom: 3 }}
      >
        <span>{label}</span>
        <div style={{ flex: 1 }} />
        <span className="mono">{pct}%</span>
      </div>
      <div
        style={{ height: 3, background: "var(--bg-overlay)", borderRadius: 2 }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: pct > 70 ? "var(--warn)" : "var(--fg-2)",
            borderRadius: 2,
          }}
        />
      </div>
    </div>
  );
}
