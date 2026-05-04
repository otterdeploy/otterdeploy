// Settings — build configs, scaling, team, integrations, account, danger zone.
// Ported from /tmp/anth-design-qP3sS7/otterstack/project/screens3.jsx (Settings + sub-tabs).

import { useEffect, useState } from "react";

import { I } from "../icons";
import { BUILDERS, SERVICES, TEAM, USER, rid, type TeamMember } from "../data";
import { BuilderCard, BuilderConfig, Field, SectionH, SettingRow } from "../components/form";

type Tab = "build" | "scaling" | "team" | "integrations" | "account" | "danger";

export function Settings() {
  const [tab, setTab] = useState<Tab>("build");
  const tabs: Array<[Tab, string, (typeof I)[keyof typeof I]]> = [
    ["build", "Build & deploy", I.bolt],
    ["scaling", "Scaling", I.scale],
    ["team", "Team", I.users],
    ["integrations", "Integrations", I.link],
    ["account", "Account", I.user],
    ["danger", "Danger zone", I.warning],
  ];
  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
      <aside
        style={{ width: 200, borderRight: "1px solid var(--border)", padding: "14px 0", flexShrink: 0 }}
      >
        <div
          className="muted"
          style={{
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            padding: "0 16px",
            marginBottom: 8,
          }}
        >
          Settings
        </div>
        <div className="col">
          {tabs.map(([id, lab, Ic]) => (
            <button
              key={id}
              className={`os-nav-item ${tab === id ? "active" : ""}`}
              onClick={() => setTab(id)}
              style={{ marginRight: 8 }}
            >
              <Ic className="icon" width={13} height={13} /> <span>{lab}</span>
            </button>
          ))}
        </div>
      </aside>
      <div style={{ flex: 1, overflow: "auto" }} className="os-scroll">
        {tab === "build" && <BuildSettings />}
        {tab === "scaling" && <ScalingSettings />}
        {tab === "team" && <TeamSettings />}
        {tab === "integrations" && <IntegrationsSettings />}
        {tab === "account" && <AccountSettings />}
        {tab === "danger" && <DangerZone />}
      </div>
    </div>
  );
}

// ────── Build & deploy ──────
function BuildSettings() {
  const [service, setService] = useState("api");
  const services = SERVICES.filter((s) => s.kind === "service");
  const [builderId, setBuilderId] = useState("railpack");
  const [autoDeploy] = useState(true);
  const [healthGate] = useState(true);

  return (
    <div style={{ padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <SectionH
        title="Build & deploy"
        sub="Per-service build configuration · changes apply on the next deploy"
      />

      {/* service picker */}
      <div
        className="row gap-1"
        style={{
          background: "var(--bg-sunken)",
          padding: 2,
          borderRadius: 6,
          border: "1px solid var(--border)",
          display: "inline-flex",
          marginTop: 14,
          marginBottom: 18,
        }}
      >
        {services.map((s) => (
          <button
            key={s.id}
            onClick={() => setService(s.id)}
            className="mono"
            style={{
              padding: "4px 10px",
              fontSize: 12,
              borderRadius: 4,
              background: service === s.id ? "var(--bg-elev)" : "transparent",
              color: service === s.id ? "var(--fg)" : "var(--fg-3)",
              fontWeight: service === s.id ? 500 : 400,
              cursor: "pointer",
              boxShadow: service === s.id ? "var(--shadow-sm)" : "none",
              border: 0,
            }}
          >
            {s.name}
          </button>
        ))}
      </div>

      {/* builder picker */}
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Build provider</div>
      <div
        style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 22 }}
      >
        {BUILDERS.map((b) => (
          <BuilderCard key={b.id} builder={b} active={builderId === b.id} onClick={() => setBuilderId(b.id)} />
        ))}
      </div>

      {/* per-builder config */}
      <BuilderConfig builderId={builderId} service={service} />

      {/* common */}
      <div style={{ height: 22 }} />
      <SectionH title="Deploy" />
      <div className="card" style={{ padding: 18, marginTop: 12 }}>
        <Field label="Deploy command">
          <input
            className="input mono"
            defaultValue={
              service === "web"
                ? "pnpm start"
                : service === "api"
                  ? "node dist/server.js"
                  : "celery -A app worker"
            }
          />
        </Field>
        <div style={{ height: 12 }} />
        <Field label="Watch paths (only redeploy if changed)">
          <input
            className="input mono"
            defaultValue={
              service === "web"
                ? "apps/web/**"
                : service === "api"
                  ? "apps/api/**, packages/shared/**"
                  : "apps/worker/**"
            }
          />
        </Field>
        <div style={{ height: 12 }} />
        <SettingRow
          label="Auto-deploy on push"
          sub="Trigger a build whenever the watched branch updates"
          defaultOn={autoDeploy}
        />
        <SettingRow
          label="Block deploy on failed health check"
          sub="If new replicas don't pass /health, keep the old ones running"
          defaultOn={healthGate}
        />
        <SettingRow
          label="Zero-downtime rolling deploy"
          sub="Drain old replicas only after new ones report ready"
          defaultOn
        />
      </div>
    </div>
  );
}

// ────── Scaling ──────
function ScalingSettings() {
  const [service, setService] = useState("api");
  const services = SERVICES.filter((s) => s.kind === "service");
  const cur = services.find((s) => s.id === service);
  const [replicas, setReplicas] = useState(cur?.replicas || 2);
  const [strategy, setStrategy] = useState<"replicated" | "global">("replicated");
  const [autoscale] = useState(false);
  const [cpu, setCpu] = useState(0.5);
  const [mem, setMem] = useState(512);

  useEffect(() => {
    const c = services.find((s) => s.id === service);
    if (c) setReplicas(c.replicas || 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service]);

  return (
    <div style={{ padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <SectionH
        title="Scaling"
        sub="Powered by Docker Swarm · changes apply via rolling update across the cluster"
      />

      <div
        className="row gap-1"
        style={{
          background: "var(--bg-sunken)",
          padding: 2,
          borderRadius: 6,
          border: "1px solid var(--border)",
          display: "inline-flex",
          marginTop: 14,
          marginBottom: 18,
        }}
      >
        {services.map((s) => (
          <button
            key={s.id}
            onClick={() => setService(s.id)}
            className="mono"
            style={{
              padding: "4px 10px",
              fontSize: 12,
              borderRadius: 4,
              background: service === s.id ? "var(--bg-elev)" : "transparent",
              color: service === s.id ? "var(--fg)" : "var(--fg-3)",
              fontWeight: service === s.id ? 500 : 400,
              cursor: "pointer",
              boxShadow: service === s.id ? "var(--shadow-sm)" : "none",
              border: 0,
            }}
          >
            {s.name}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div className="card" style={{ padding: 18 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>Replicas</div>
          <div className="row gap-2">
            <button className="btn ghost icon" onClick={() => setReplicas((r) => Math.max(1, r - 1))}>
              <I.x width={11} height={11} />
            </button>
            <input
              className="input mono"
              type="number"
              value={replicas}
              onChange={(e) => setReplicas(+e.target.value || 1)}
              style={{ width: 80, textAlign: "center", fontSize: 18, height: 36 }}
            />
            <button className="btn ghost icon" onClick={() => setReplicas((r) => r + 1)}>
              <I.plus width={11} height={11} />
            </button>
            <div style={{ flex: 1 }} />
            <span className="mono muted" style={{ fontSize: 11 }}>
              across {Math.min(replicas, 3)} node{replicas > 1 ? "s" : ""}
            </span>
          </div>
          {/* node distribution viz */}
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
                  <div className="mono" style={{ fontSize: 10, color: "var(--fg-3)" }}>node-{n + 1}</div>
                  <div className="row gap-1" style={{ marginTop: 6, flexWrap: "wrap" }}>
                    {Array.from({ length: Math.max(0, onThisNode) }).map((_, i) => (
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
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ height: 14 }} />
          <Field label="Distribution strategy">
            <select
              className="input"
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as "replicated" | "global")}
            >
              <option value="replicated">Replicated (N copies, scheduler chooses nodes)</option>
              <option value="global">Global (1 replica per node, always)</option>
            </select>
          </Field>
        </div>

        <div className="card" style={{ padding: 18 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>Resources (per replica)</div>
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
          <Field label={`Memory limit · ${mem >= 1024 ? (mem / 1024).toFixed(1) + " GB" : mem + " MB"}`}>
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
          <div style={{ height: 14 }} />
          <div
            className="row gap-3"
            style={{
              padding: 10,
              background: "var(--bg-sunken)",
              borderRadius: 6,
              border: "1px solid var(--border)",
            }}
          >
            <div>
              <div
                className="muted"
                style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}
              >
                cluster total
              </div>
              <div className="mono" style={{ fontSize: 14, fontWeight: 500 }}>
                {(cpu * replicas).toFixed(1)} vCPU · {((mem * replicas) / 1024).toFixed(1)} GB
              </div>
            </div>
            <div style={{ flex: 1 }} />
            <span className="badge ok"><span className="dot" />fits available capacity</span>
          </div>
        </div>
      </div>

      <div style={{ height: 22 }} />
      <SectionH title="Autoscaling" />
      <div className="card" style={{ padding: 18, marginTop: 12 }}>
        <SettingRow
          label="Enable autoscaling"
          sub="Add or remove replicas based on the metric below"
          defaultOn={autoscale}
        />
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 12 }}
        >
          <Field label="Metric">
            <select className="input">
              <option>CPU utilization</option>
              <option>Memory utilization</option>
              <option>Queue depth (redis)</option>
              <option>Request latency (p95)</option>
            </select>
          </Field>
          <Field label="Target value"><input className="input mono" defaultValue="60%" /></Field>
          <Field label="Min – Max replicas">
            <div className="row gap-2">
              <input className="input mono" defaultValue="2" style={{ width: 70 }} />
              <span className="muted">–</span>
              <input className="input mono" defaultValue="10" style={{ width: 70 }} />
            </div>
          </Field>
        </div>
      </div>

      <div style={{ height: 22 }} />
      <SectionH title="Generated docker stack" />
      <div className="card" style={{ overflow: "hidden", marginTop: 12 }}>
        <div
          className="row"
          style={{
            padding: "8px 14px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-sunken)",
          }}
        >
          <span className="badge mono" style={{ background: "var(--bg-elev)" }}>stack.yml · {service}</span>
          <div style={{ flex: 1 }} />
          <span className="mono muted" style={{ fontSize: 11 }}>
            read-only — applied via `docker stack deploy`
          </span>
        </div>
        <pre
          className="mono"
          style={{ margin: 0, padding: 14, fontSize: 12, lineHeight: 1.7, color: "var(--fg-2)" }}
        >{`services:
  ${service}:
    image: registry.helio.internal/${service}:latest
    deploy:
      mode: ${strategy}
      replicas: ${replicas}
      resources:
        limits:
          cpus: "${cpu.toFixed(2)}"
          memory: ${mem}M
      update_config:
        parallelism: ${Math.max(1, Math.floor(replicas / 2))}
        order: start-first
        failure_action: rollback
      restart_policy:
        condition: any
        delay: 5s
    networks: [helio_internal]`}</pre>
      </div>
    </div>
  );
}

// ────── Team ──────
function TeamSettings() {
  const [team, setTeam] = useState<TeamMember[]>(TEAM);
  const [inviteOpen, setInviteOpen] = useState(false);

  return (
    <div style={{ padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <div className="row" style={{ marginBottom: 14 }}>
        <SectionH
          title="Team"
          sub={`${team.length} members in ${USER.org} · self-hosted SSO via Better Auth`}
        />
        <div style={{ flex: 1 }} />
        <button className="btn"><I.users width={12} height={12} /> Roles</button>
        <div style={{ width: 8 }} />
        <button className="btn primary" onClick={() => setInviteOpen(true)}>
          <I.plus width={12} height={12} /> Invite
        </button>
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        <div className="os-pe-head" style={{ padding: "10px 14px" }}>
          <span style={{ flex: 2 }}>Member</span>
          <span style={{ width: 130 }}>Role</span>
          <span style={{ width: 100 }}>2FA</span>
          <span style={{ width: 130 }}>Last active</span>
          <span style={{ width: 60, textAlign: "right" }} />
        </div>
        {team.map((m, i) => (
          <div
            key={m.id}
            className="row"
            style={{
              padding: "10px 14px",
              borderTop: i > 0 ? "1px solid var(--border)" : "none",
              fontSize: 13,
            }}
          >
            <span style={{ flex: 2, display: "flex", alignItems: "center", gap: 10 }}>
              <Avatar initials={m.initials} />
              <div>
                <div style={{ fontWeight: 500 }}>
                  {m.name}{" "}
                  {m.you && <span className="badge" style={{ marginLeft: 6 }}>you</span>}
                </div>
                <div className="mono muted" style={{ fontSize: 11 }}>{m.email}</div>
              </div>
            </span>
            <span style={{ width: 130 }}>
              <select
                className="input"
                value={m.role}
                onChange={(e) =>
                  setTeam((t) =>
                    t.map((x) =>
                      x.id === m.id
                        ? { ...x, role: e.target.value as TeamMember["role"] }
                        : x,
                    ),
                  )
                }
                style={{ width: "100%", height: 26 }}
              >
                <option value="admin">admin</option>
                <option value="developer">developer</option>
                <option value="viewer">viewer</option>
              </select>
            </span>
            <span style={{ width: 100 }}>
              {m.mfa ? (
                <span className="badge ok"><span className="dot" />enabled</span>
              ) : (
                <span className="badge warn"><span className="dot" />off</span>
              )}
            </span>
            <span style={{ width: 130 }} className="mono muted">{m.last}</span>
            <span style={{ width: 60, textAlign: "right" }}>
              <button className="btn ghost icon sm"><I.more width={12} height={12} /></button>
            </span>
          </div>
        ))}
      </div>

      <div style={{ height: 22 }} />
      <SectionH title="Roles & permissions" />
      <div className="card" style={{ overflow: "hidden", marginTop: 12 }}>
        <div className="os-pe-head" style={{ padding: "10px 14px" }}>
          <span style={{ flex: 2 }}>Capability</span>
          <span style={{ flex: 1, textAlign: "center" }}>admin</span>
          <span style={{ flex: 1, textAlign: "center" }}>developer</span>
          <span style={{ flex: 1, textAlign: "center" }}>viewer</span>
        </div>
        {(
          [
            ["Deploy services", true, true, false],
            ["Edit environment variables", true, true, false],
            ["Read secrets", true, true, false],
            ["Manage team & billing", true, false, false],
            ["Edit Caddy config", true, false, false],
            ["View logs & metrics", true, true, true],
            ["Run database console", true, true, false],
          ] as Array<[string, boolean, boolean, boolean]>
        ).map((row) => (
          <div
            key={row[0]}
            className="row"
            style={{ padding: "8px 14px", borderTop: "1px solid var(--border)", fontSize: 12 }}
          >
            <span style={{ flex: 2 }}>{row[0]}</span>
            {[1, 2, 3].map((j) => (
              <span key={j} style={{ flex: 1, textAlign: "center" }}>
                {row[j as 1 | 2 | 3] ? (
                  <I.check width={13} height={13} style={{ color: "var(--ok)" }} />
                ) : (
                  <I.x width={11} height={11} style={{ color: "var(--fg-4)" }} />
                )}
              </span>
            ))}
          </div>
        ))}
      </div>

      {inviteOpen && (
        <InviteModal
          onClose={() => setInviteOpen(false)}
          onInvite={(name, email, role) => {
            setTeam((t) => [
              ...t,
              {
                id: "t_" + rid(),
                name,
                email,
                initials: name
                  .split(" ")
                  .map((p) => p[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase(),
                role,
                last: "pending",
                mfa: false,
              },
            ]);
            setInviteOpen(false);
          }}
        />
      )}
    </div>
  );
}

function Avatar({ initials, size = 30 }: { initials: string; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "var(--bg-sunken)",
        border: "1px solid var(--border)",
        color: "var(--fg-2)",
        fontFamily: "var(--font-mono)",
        fontSize: size * 0.36,
        fontWeight: 600,
        display: "grid",
        placeItems: "center",
        flexShrink: 0,
      }}
    >
      {initials}
    </div>
  );
}

function InviteModal({
  onClose,
  onInvite,
}: {
  onClose: () => void;
  onInvite: (name: string, email: string, role: TeamMember["role"]) => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamMember["role"]>("developer");
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
      }}
    >
      <div onClick={(e) => e.stopPropagation()} className="os-modal" style={{ width: 440 }}>
        <div className="row gap-2 os-modal-h">
          <I.users width={14} height={14} />
          <span style={{ fontWeight: 600 }}>Invite to {USER.org}</span>
          <div style={{ flex: 1 }} />
          <button className="btn ghost icon sm" onClick={onClose}><I.close width={13} height={13} /></button>
        </div>
        <div className="col gap-3" style={{ padding: 18 }}>
          <Field label="Email address">
            <input
              className="input mono"
              placeholder="teammate@paperhouse.dev"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Role">
            <select
              className="input"
              value={role}
              onChange={(e) => setRole(e.target.value as TeamMember["role"])}
            >
              <option value="admin">admin · full access</option>
              <option value="developer">developer · deploy & edit</option>
              <option value="viewer">viewer · read-only</option>
            </select>
          </Field>
          <div className="muted" style={{ fontSize: 11 }}>An invite link valid for 72h will be emailed.</div>
        </div>
        <div className="row gap-2" style={{ padding: 14, borderTop: "1px solid var(--border)" }}>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            onClick={() => email && onInvite(email.split("@")[0]!, email, role)}
          >
            Send invite
          </button>
        </div>
      </div>
    </div>
  );
}

// ────── Integrations ──────
function IntegrationsSettings() {
  const items: Array<{ name: string; sub: string; on: boolean }> = [
    { name: "GitHub", sub: "paperhouse/helio · webhook deploys", on: true },
    { name: "GitLab", sub: "Connect a self-hosted instance", on: false },
    { name: "Slack", sub: "Deploy + incident notifications", on: true },
    { name: "Sentry", sub: "Error reporting · auto-link releases to deploys", on: true },
    { name: "Datadog", sub: "Metrics + APM · stream Caddy access logs", on: false },
    { name: "PagerDuty", sub: "Page on-call when /health fails", on: false },
  ];
  return (
    <div style={{ padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <SectionH title="Integrations" sub="Source control, observability, alerting" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 14 }}>
        {items.map((p) => (
          <div key={p.name} className="card" style={{ padding: 14 }}>
            <div className="row gap-2">
              <span style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</span>
              {p.on ? (
                <span className="badge ok"><span className="dot" />connected</span>
              ) : (
                <span className="badge"><span className="dot" style={{ background: "var(--fg-4)" }} />not connected</span>
              )}
              <div style={{ flex: 1 }} />
              <button className="btn sm">{p.on ? "Configure" : "Connect"}</button>
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{p.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ────── Account ──────
function AccountSettings() {
  return (
    <div style={{ padding: 24, maxWidth: 760, margin: "0 auto" }}>
      <SectionH title="Account" sub="Personal preferences for your Otterstack login" />

      <div
        className="card"
        style={{
          padding: 18,
          marginTop: 14,
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: 16,
          alignItems: "center",
        }}
      >
        <Avatar initials={USER.initials} size={64} />
        <div>
          <div style={{ fontWeight: 600, fontSize: 16 }}>{USER.name}</div>
          <div className="mono muted" style={{ fontSize: 12 }}>{USER.email}</div>
          <div className="row gap-2" style={{ marginTop: 8 }}>
            <button className="btn sm">Change avatar</button>
            <button className="btn sm ghost">Update profile</button>
          </div>
        </div>
      </div>

      <div style={{ height: 18 }} />
      <SectionH title="Profile" />
      <div className="card" style={{ padding: 18, marginTop: 12 }}>
        <Field label="Display name"><input className="input" defaultValue={USER.name} /></Field>
        <div style={{ height: 12 }} />
        <Field label="Email"><input className="input mono" defaultValue={USER.email} /></Field>
        <div style={{ height: 12 }} />
        <Field label="Username"><input className="input mono" defaultValue="mira" /></Field>
        <div style={{ height: 12 }} />
        <Field label="Default organization">
          <select className="input">
            {USER.orgs.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </Field>
      </div>

      <div style={{ height: 18 }} />
      <SectionH title="Authentication" />
      <div className="card" style={{ padding: 18, marginTop: 12 }}>
        <SettingRow
          label="Two-factor authentication"
          sub="TOTP via authenticator app · backup codes generated"
          defaultOn
        />
        <SettingRow
          label="Email on new device sign-in"
          sub="Send a notification when a new device authenticates"
          defaultOn
        />
        <SettingRow label="Passkey support" sub="Allow WebAuthn for passwordless sign-in" defaultOn />
      </div>

      <div style={{ height: 18 }} />
      <SectionH title="API & CLI" />
      <div className="card" style={{ padding: 18, marginTop: 12 }}>
        <Field label="Personal access token">
          <div className="row gap-2">
            <input
              className="input mono"
              defaultValue="otts_••••••••••••••••••••••••"
              style={{ flex: 1 }}
            />
            <button className="btn"><I.copy width={11} height={11} /> Copy</button>
            <button className="btn">Rotate</button>
          </div>
        </Field>
        <div style={{ height: 12 }} />
        <div className="muted" style={{ fontSize: 11, lineHeight: 1.6 }}>
          Use this token with the <span className="mono" style={{ color: "var(--fg-2)" }}>otterstack</span> CLI:
          <br />
          <span className="mono" style={{ color: "var(--fg-2)", display: "inline-block", marginTop: 4 }}>
            $ otterstack login --token $OTTS_TOKEN
          </span>
        </div>
      </div>

      <div style={{ height: 18 }} />
      <SectionH title="Sessions" />
      <div className="card" style={{ padding: 14, marginTop: 12 }}>
        {[
          { dev: "MacBook Pro · Chrome", loc: "San Francisco, CA", ip: "74.12.4.18", last: "now", current: true },
          { dev: "iPhone 17 · Safari", loc: "San Francisco, CA", ip: "74.12.4.18", last: "4h ago", current: false },
          { dev: "Linux · Firefox", loc: "Brooklyn, NY", ip: "108.59.32.4", last: "3d ago", current: false },
        ].map((s, i) => (
          <div
            key={i}
            className="row"
            style={{
              padding: "10px 0",
              borderTop: i > 0 ? "1px solid var(--border)" : "none",
              fontSize: 12,
            }}
          >
            <span style={{ flex: 2, fontWeight: 500 }}>{s.dev}</span>
            <span style={{ flex: 1, color: "var(--fg-2)" }}>{s.loc}</span>
            <span style={{ flex: 1 }} className="mono muted">{s.ip}</span>
            <span style={{ width: 80, textAlign: "right" }} className="mono muted">{s.last}</span>
            <span style={{ width: 100, textAlign: "right" }}>
              {s.current ? (
                <span className="badge ok"><span className="dot" />current</span>
              ) : (
                <button className="btn sm ghost" style={{ color: "var(--err)" }}>Revoke</button>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DangerZone() {
  return (
    <div style={{ padding: 24, maxWidth: 760, margin: "0 auto" }}>
      <SectionH title="Danger zone" sub="Irreversible actions — please type the project name to confirm" />
      <div className="card" style={{ padding: 18, marginTop: 14, borderColor: "var(--err)" }}>
        <div className="row gap-2">
          <I.warning width={14} height={14} style={{ color: "var(--err)" }} />
          <span style={{ fontWeight: 600, fontSize: 13 }}>Transfer project</span>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          Move <span className="mono" style={{ color: "var(--fg-2)" }}>helio</span> to another organization. Services,
          secrets, and history move with it.
        </div>
        <div className="row gap-2" style={{ marginTop: 12 }}>
          <input className="input mono" placeholder="target organization slug" style={{ flex: 1 }} />
          <button className="btn">Transfer</button>
        </div>
      </div>

      <div className="card" style={{ padding: 18, marginTop: 14, borderColor: "var(--err)" }}>
        <div className="row gap-2">
          <I.warning width={14} height={14} style={{ color: "var(--err)" }} />
          <span style={{ fontWeight: 600, fontSize: 13 }}>Delete project</span>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          This will tear down all services, drop databases, revoke certificates, and remove all secrets. This cannot be
          undone.
        </div>
        <div className="row gap-2" style={{ marginTop: 12 }}>
          <input className="input mono" placeholder='type "helio" to confirm' style={{ flex: 1 }} />
          <button
            className="btn"
            style={{ background: "var(--err-bg)", color: "var(--err)", borderColor: "var(--err)" }}
          >
            Delete project
          </button>
        </div>
      </div>
    </div>
  );
}
