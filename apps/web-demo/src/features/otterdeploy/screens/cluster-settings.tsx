// Cluster settings — for the otterdeploy control plane itself (not project-scoped).

import { useState } from "react";

import { I } from "../icons";
import { NODES } from "../data";
import { Field, SectionH, SettingRow, Switch3 } from "../components/form";

type Tab =
  | "general"
  | "raft"
  | "image-cache"
  | "log-retention"
  | "backups"
  | "security"
  | "telemetry"
  | "maintenance";

export function ClusterSettings() {
  const [tab, setTab] = useState<Tab>("general");

  const tabs: Array<[Tab, string, (typeof I)[keyof typeof I]]> = [
    ["general", "General", I.settings],
    ["raft", "Raft & quorum", I.cpu],
    ["image-cache", "Image cache", I.folder],
    ["log-retention", "Log retention", I.log],
    ["backups", "Backups defaults", I.download],
    ["security", "Security", I.lock],
    ["telemetry", "Telemetry", I.metrics],
    ["maintenance", "Maintenance", I.warning],
  ];

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
      <aside
        style={{
          width: 200,
          borderRight: "1px solid var(--border)",
          padding: "14px 0",
          flexShrink: 0,
          position: "sticky",
          top: 0,
          alignSelf: "flex-start",
          height: "100%",
          overflowY: "auto",
        }}
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
          Cluster
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
        {tab === "general" && <GeneralPane />}
        {tab === "raft" && <RaftPane />}
        {tab === "image-cache" && <ImageCachePane />}
        {tab === "log-retention" && <LogRetentionPane />}
        {tab === "backups" && <BackupsPane />}
        {tab === "security" && <SecurityPane />}
        {tab === "telemetry" && <TelemetryPane />}
        {tab === "maintenance" && <MaintenancePane />}
      </div>
    </div>
  );
}

// ────── General ──────
function GeneralPane() {
  return (
    <div style={{ padding: 24, maxWidth: 880, margin: "0 auto" }}>
      <SectionH title="General" sub="Identity and primary endpoint of this otterdeploy control plane" />
      <div className="card" style={{ padding: 18, marginTop: 14 }}>
        <Field label="Cluster name">
          <input className="input mono" defaultValue="otterdeploy-helio-prod" />
        </Field>
        <div style={{ height: 12 }} />
        <Field label="Admin URL">
          <input className="input mono" defaultValue="https://admin.helio.so" />
        </Field>
        <div style={{ height: 12 }} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Default region">
            <select className="input" defaultValue="sfo">
              <option value="sfo">sfo · San Francisco</option>
              <option value="iad">iad · Virginia</option>
              <option value="lhr">lhr · London</option>
              <option value="fra">fra · Frankfurt</option>
              <option value="sgp">sgp · Singapore</option>
            </select>
          </Field>
          <Field label="Time zone">
            <select className="input" defaultValue="America/Los_Angeles">
              <option>America/Los_Angeles</option>
              <option>America/New_York</option>
              <option>UTC</option>
              <option>Europe/London</option>
              <option>Asia/Singapore</option>
            </select>
          </Field>
        </div>
      </div>

      <div style={{ height: 22 }} />
      <SectionH title="Control plane version" />
      <div
        className="card row gap-3"
        style={{ padding: 18, marginTop: 12, alignItems: "center" }}
      >
        <div>
          <div className="row gap-2" style={{ alignItems: "baseline" }}>
            <span className="mono" style={{ fontSize: 18, fontWeight: 600 }}>v1.4.2-rc.1</span>
            <span className="badge warn">
              <span className="dot" />
              Update available v1.4.3
            </span>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Released 14 Apr 2026 · 18 commits since this build · includes Caddy 2.8.5 + Swarm scheduler fix.
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn">View changelog</button>
        <button className="btn primary">
          <I.download width={11} height={11} /> Update cluster
        </button>
      </div>

      <div style={{ height: 22 }} />
      <SectionH title="Status" />
      <div
        className="card"
        style={{
          padding: 18,
          marginTop: 12,
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 14,
        }}
      >
        {[
          { label: "Nodes", value: `${NODES.length} ready`, tone: "var(--ok)" },
          { label: "Stacks", value: "12 deployed", tone: "var(--fg-2)" },
          { label: "Uptime", value: "62d 4h", tone: "var(--fg-2)" },
          { label: "License", value: "self-host", tone: "var(--info)" },
        ].map((s) => (
          <div key={s.label}>
            <div
              className="muted"
              style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}
            >
              {s.label}
            </div>
            <div className="mono" style={{ fontSize: 14, fontWeight: 500, color: s.tone, marginTop: 2 }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ────── Raft & quorum ──────
function RaftPane() {
  const managers = NODES.filter((n) => n.role === "manager");
  const allHealthy = managers.every((m) => m.status === "ready");
  return (
    <div style={{ padding: 24, maxWidth: 880, margin: "0 auto" }}>
      <SectionH title="Raft & quorum" sub="Manager peers gossip via Raft to keep the cluster state consistent" />

      <div className="card" style={{ marginTop: 14, overflow: "hidden" }}>
        <div
          className="row"
          style={{
            padding: "12px 14px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-sunken)",
          }}
        >
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Current quorum</div>
            <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
              {managers.length}/{NODES.length} managers · {allHealthy ? "all healthy" : "degraded"}
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <span className={`badge ${allHealthy ? "ok" : "warn"}`}>
            <span className="dot" />
            {managers.length} of {Math.max(1, Math.floor(NODES.length / 2) + 1)} required
          </span>
        </div>

        <div className="os-pe-head" style={{ padding: "8px 14px" }}>
          <span style={{ flex: 1.2 }}>Manager</span>
          <span style={{ width: 120 }}>Role</span>
          <span style={{ width: 130 }}>Address</span>
          <span style={{ width: 130 }}>Daemon</span>
          <span style={{ width: 100 }}>Reachable</span>
          <span style={{ width: 90, textAlign: "right" }}>Action</span>
        </div>
        {NODES.map((n, i) => {
          const isManager = n.role === "manager";
          const isLeader = i === 0 && isManager;
          return (
            <div
              key={n.id}
              className="row"
              style={{
                padding: "10px 14px",
                borderTop: "1px solid var(--border)",
                fontSize: 12,
                alignItems: "center",
                opacity: isManager ? 1 : 0.6,
              }}
            >
              <span style={{ flex: 1.2, fontWeight: 500 }} className="mono">
                {n.name}{" "}
                {isLeader && <span className="badge ok" style={{ marginLeft: 4 }}>leader</span>}
              </span>
              <span style={{ width: 120 }} className="mono muted">{n.role}</span>
              <span style={{ width: 130 }} className="mono">{n.host}:2377</span>
              <span style={{ width: 130 }} className="mono muted">{n.daemonVersion}</span>
              <span style={{ width: 100 }}>
                {n.status === "ready" ? (
                  <span className="badge ok"><span className="dot" />reachable</span>
                ) : (
                  <span className="badge err"><span className="dot" />unreachable</span>
                )}
              </span>
              <span style={{ width: 90, textAlign: "right" }}>
                {isManager && !isLeader && (
                  <button className="btn sm ghost">Demote</button>
                )}
                {!isManager && <button className="btn sm ghost">Promote</button>}
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ height: 22 }} />
      <SectionH title="Raft tunables" sub="Defaults are safe — only adjust under guidance" />
      <div className="card" style={{ padding: 18, marginTop: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Heartbeat interval (ms)">
            <input className="input mono" defaultValue="1000" />
          </Field>
          <Field label="Election timeout (ms)">
            <input className="input mono" defaultValue="3000" />
          </Field>
          <Field label="Snapshot interval (entries)">
            <input className="input mono" defaultValue="10000" />
          </Field>
          <Field label="Snapshot retention">
            <input className="input mono" defaultValue="5" />
          </Field>
        </div>
        <div style={{ height: 12 }} />
        <Field label="Advertise address">
          <input className="input mono" defaultValue="10.0.4.11:2377" />
        </Field>
      </div>
    </div>
  );
}

// ────── Image cache ──────
function ImageCachePane() {
  const [size, setSize] = useState(40);
  return (
    <div style={{ padding: 24, maxWidth: 880, margin: "0 auto" }}>
      <SectionH
        title="Image cache"
        sub="Layers and built images are kept on disk per node so redeploys don't pull from the registry"
      />
      <div className="card" style={{ padding: 18, marginTop: 14 }}>
        <SettingRow
          label="Enable on-disk cache"
          sub="Reuse pulled & built layers across deploys"
          defaultOn
        />
        <div style={{ height: 12 }} />
        <Field label="Cache root path">
          <input className="input mono" defaultValue="/var/lib/otterdeploy/cache" />
        </Field>
        <div style={{ height: 14 }} />
        <Field label={`Max size · ${size} GB`}>
          <input
            type="range"
            min={5}
            max={200}
            step={5}
            value={size}
            onChange={(e) => setSize(+e.target.value)}
            style={{ width: "100%" }}
          />
        </Field>
        <div style={{ height: 12 }} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Eviction policy">
            <select className="input" defaultValue="lru">
              <option value="lru">LRU · least recently used</option>
              <option value="fifo">FIFO · oldest first</option>
            </select>
          </Field>
          <Field label="High-water mark">
            <input className="input mono" defaultValue="85%" />
          </Field>
        </div>
        <div style={{ height: 12 }} />
        <SettingRow
          label="Prune untagged images"
          sub="Aggressively remove dangling images on every garbage collection cycle"
          defaultOn
        />
      </div>

      <div style={{ height: 18 }} />
      <div
        className="card row gap-3"
        style={{
          padding: 18,
          alignItems: "center",
          borderColor: "var(--border-strong)",
        }}
      >
        <div>
          <div style={{ fontWeight: 600, fontSize: 13 }}>Clear cache</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Wipe ~12.4 GB of cached layers across all 3 nodes. Next deploy will be slower.
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <button
          className="btn"
          style={{ background: "var(--err-bg)", color: "var(--err)", borderColor: "var(--err)" }}
        >
          Clear cache
        </button>
      </div>
    </div>
  );
}

// ────── Log retention ──────
function LogRetentionPane() {
  const [sample, setSample] = useState(20);
  return (
    <div style={{ padding: 24, maxWidth: 880, margin: "0 auto" }}>
      <SectionH
        title="Log retention"
        sub="Per-stream policies for how long otterdeploy keeps logs locally"
      />
      <div className="card" style={{ padding: 0, marginTop: 14, overflow: "hidden" }}>
        <div className="os-pe-head" style={{ padding: "10px 14px" }}>
          <span style={{ flex: 1 }}>Stream</span>
          <span style={{ width: 130 }}>Default</span>
          <span style={{ width: 130 }}>Override</span>
          <span style={{ flex: 1.4 }}>Notes</span>
        </div>
        {[
          { stream: "App logs", def: "7 days", opts: ["1d", "3d", "7d", "14d", "30d"], note: "stdout/stderr from each replica" },
          { stream: "Edge logs (Caddy)", def: "14 days", opts: ["7d", "14d", "30d", "90d"], note: "structured access log per request" },
          { stream: "Audit logs", def: "365 days", opts: ["90d", "180d", "365d", "forever"], note: "who did what — sealed, append-only" },
          { stream: "Build logs", def: "30 days", opts: ["7d", "14d", "30d", "90d"], note: "kept per deploy, deleted on rollback" },
        ].map((s, i) => (
          <div
            key={s.stream}
            className="row"
            style={{
              padding: "10px 14px",
              borderTop: i > 0 ? "1px solid var(--border)" : "none",
              fontSize: 12,
              alignItems: "center",
            }}
          >
            <span style={{ flex: 1, fontWeight: 500 }}>{s.stream}</span>
            <span style={{ width: 130 }} className="mono muted">{s.def}</span>
            <span style={{ width: 130 }}>
              <select className="input" defaultValue={s.opts[Math.floor(s.opts.length / 2)]} style={{ height: 26 }}>
                {s.opts.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </span>
            <span style={{ flex: 1.4 }} className="muted">{s.note}</span>
          </div>
        ))}
      </div>

      <div style={{ height: 22 }} />
      <SectionH title="Long-term storage" />
      <div className="card" style={{ padding: 18, marginTop: 12 }}>
        <SettingRow
          label="Aggregate to S3-compatible bucket"
          sub="Stream all log types to object storage past their local retention window"
          defaultOn
        />
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginTop: 12 }}>
          <Field label="Bucket URL">
            <input className="input mono" defaultValue="s3://helio-logs-archive" />
          </Field>
          <Field label="Region">
            <input className="input mono" defaultValue="us-west-2" />
          </Field>
        </div>
        <div style={{ height: 8 }} />
        <SettingRow
          label="Encrypt at rest (SSE-KMS)"
          sub="Use a customer-managed KMS key when uploading"
          defaultOn
        />
      </div>

      <div style={{ height: 22 }} />
      <SectionH title="Sampling" />
      <div className="card" style={{ padding: 18, marginTop: 12 }}>
        <Field label={`Sample rate for noisy services · ${sample}%`}>
          <input
            type="range"
            min={1}
            max={100}
            step={1}
            value={sample}
            onChange={(e) => setSample(+e.target.value)}
            style={{ width: "100%" }}
          />
        </Field>
        <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
          Applies to services tagged <span className="mono" style={{ color: "var(--fg-2)" }}>log-volume:high</span> ·
          errors and warnings are always kept (1.0).
        </div>
      </div>
    </div>
  );
}

// ────── Backups ──────
function BackupsPane() {
  return (
    <div style={{ padding: 24, maxWidth: 880, margin: "0 auto" }}>
      <SectionH
        title="Backups defaults"
        sub="Project-level backups inherit these unless overridden"
      />
      <div className="card" style={{ padding: 18, marginTop: 14 }}>
        <Field label="Default destination">
          <select className="input" defaultValue="s3">
            <option value="s3">S3-compatible (Backblaze B2)</option>
            <option value="local">Local volume on each node</option>
            <option value="restic">Restic repository</option>
            <option value="gcs">Google Cloud Storage</option>
          </select>
        </Field>
        <div style={{ height: 12 }} />
        <Field label="Bucket / endpoint">
          <input className="input mono" defaultValue="https://s3.us-west-002.backblazeb2.com/helio-backups" />
        </Field>
        <div style={{ height: 12 }} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Default encryption">
            <select className="input" defaultValue="age">
              <option value="age">age — modern, audited</option>
              <option value="gpg">GPG (legacy)</option>
              <option value="none">None (not recommended)</option>
            </select>
          </Field>
          <Field label="Default retention">
            <select className="input" defaultValue="30">
              <option value="7">7 days</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="365">365 days</option>
            </select>
          </Field>
        </div>
        <div style={{ height: 12 }} />
        <Field label="Default schedule (cron)">
          <input className="input mono" defaultValue="0 4 * * *" />
        </Field>
        <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
          Daily at 04:00 in the cluster default time zone. Per-database overrides take precedence.
        </div>
      </div>

      <div style={{ height: 18 }} />
      <SectionH title="Verification" />
      <div className="card" style={{ padding: 18, marginTop: 12 }}>
        <SettingRow
          label="Auto-verify each backup"
          sub="Restore to a temporary container and run a sanity query before retaining"
          defaultOn
        />
        <SettingRow
          label="Page on backup failure"
          sub="Trigger PagerDuty if a scheduled backup misses its window or fails verification"
          defaultOn
        />
      </div>
    </div>
  );
}

// ────── Security ──────
function SecurityPane() {
  return (
    <div style={{ padding: 24, maxWidth: 880, margin: "0 auto" }}>
      <SectionH title="Security" sub="Cluster-wide identity, transport, and access policy" />

      <div style={{ height: 14 }} />
      <SectionH title="Transport" />
      <div className="card" style={{ padding: 18, marginTop: 12 }}>
        <SettingRow
          label="Enforce TLS 1.3"
          sub="Reject connections from older TLS versions at the Caddy edge"
          defaultOn
        />
        <SettingRow
          label="HSTS preload"
          sub="Send Strict-Transport-Security with includeSubdomains; preload"
          defaultOn
        />
        <SettingRow
          label="Block plain HTTP"
          sub="Refuse port 80 traffic that isn't an ACME challenge"
          defaultOn
        />
      </div>

      <div style={{ height: 18 }} />
      <SectionH title="OIDC SSO" />
      <div className="card" style={{ padding: 18, marginTop: 12 }}>
        <Field label="Issuer URL">
          <input className="input mono" defaultValue="https://auth.paperhouse.dev/realms/helio" />
        </Field>
        <div style={{ height: 12 }} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Client ID">
            <input className="input mono" defaultValue="otterdeploy-admin" />
          </Field>
          <Field label="Client secret">
            <div className="row gap-2">
              <input
                className="input mono"
                type="password"
                defaultValue="••••••••••••••••••••••"
                style={{ flex: 1 }}
              />
              <button className="btn sm">
                <I.eye width={11} height={11} />
              </button>
              <button className="btn sm">Rotate</button>
            </div>
          </Field>
        </div>
        <div style={{ height: 12 }} />
        <Field label="Scopes">
          <input className="input mono" defaultValue="openid profile email groups" />
        </Field>
        <div style={{ height: 12 }} />
        <Field label="Group → role mapping">
          <textarea
            className="input mono"
            rows={3}
            defaultValue={`paperhouse:admins → admin\npaperhouse:engineers → developer\npaperhouse:* → viewer`}
          />
        </Field>
      </div>

      <div style={{ height: 18 }} />
      <SectionH title="Access" />
      <div className="card" style={{ padding: 18, marginTop: 12 }}>
        <SettingRow
          label="Require MFA for admin actions"
          sub="Re-prompt for TOTP before destructive operations and secret reads"
          defaultOn
        />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
          <Field label="Session timeout">
            <select className="input" defaultValue="8h">
              <option value="1h">1 hour</option>
              <option value="4h">4 hours</option>
              <option value="8h">8 hours</option>
              <option value="24h">24 hours</option>
              <option value="7d">7 days</option>
            </select>
          </Field>
          <Field label="Idle timeout">
            <select className="input" defaultValue="30m">
              <option value="15m">15 minutes</option>
              <option value="30m">30 minutes</option>
              <option value="60m">60 minutes</option>
              <option value="never">Never</option>
            </select>
          </Field>
        </div>
        <div style={{ height: 12 }} />
        <Field label="Allowlist CIDRs (one per line — empty = open)">
          <textarea
            className="input mono"
            rows={4}
            defaultValue={`10.0.0.0/8\n74.12.4.0/24\n2600:1f14::/32`}
          />
        </Field>
        <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
          Applies to the admin UI and CLI. Public service traffic is unaffected.
        </div>
      </div>
    </div>
  );
}

// ────── Telemetry ──────
function TelemetryPane() {
  const [betaOn, setBetaOn] = useState(false);
  return (
    <div style={{ padding: 24, maxWidth: 880, margin: "0 auto" }}>
      <SectionH
        title="Telemetry"
        sub="What otterdeploy sends back so we can fix bugs and prioritise features"
      />
      <div className="card" style={{ padding: 18, marginTop: 14 }}>
        <SettingRow
          label="Anonymous usage stats"
          sub="Counts of deploys, screen views, and feature adoption — no project names, no env vars"
          defaultOn
        />
        <SettingRow
          label="Crash reports"
          sub="Send unhandled exceptions from the control plane"
          defaultOn
        />

        <div className="row gap-3" style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>Opt-in beta features</div>
            <div className="muted" style={{ fontSize: 11 }}>
              Show experimental UI and APIs · may break between versions
            </div>
          </div>
          <Switch3 on={betaOn} onChange={setBetaOn} />
        </div>
      </div>

      <div style={{ height: 18 }} />
      <SectionH title="Error reporting" />
      <div className="card" style={{ padding: 18, marginTop: 12 }}>
        <Field label="Sentry DSN (control plane)">
          <input
            className="input mono"
            defaultValue="https://••••••@sentry.paperhouse.dev/4501"
          />
        </Field>
        <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
          Routes otterdeploy&apos;s own exceptions to your Sentry project · separate from per-service Sentry config.
        </div>
        <div style={{ height: 12 }} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Environment tag">
            <input className="input mono" defaultValue="prod" />
          </Field>
          <Field label="Sample rate">
            <input className="input mono" defaultValue="1.0" />
          </Field>
        </div>
      </div>

      <div style={{ height: 18 }} />
      <SectionH title="OpenTelemetry" />
      <div className="card" style={{ padding: 18, marginTop: 12 }}>
        <SettingRow
          label="Export OTLP traces"
          sub="Send control-plane spans to your collector"
          defaultOn
        />
        <div style={{ height: 12 }} />
        <Field label="OTLP endpoint">
          <input className="input mono" defaultValue="https://otel.paperhouse.dev:4318/v1/traces" />
        </Field>
      </div>
    </div>
  );
}

// ────── Maintenance ──────
function MaintenancePane() {
  const [confirm, setConfirm] = useState<null | "recreate" | "reelect">(null);
  return (
    <div style={{ padding: 24, maxWidth: 880, margin: "0 auto" }}>
      <SectionH title="Maintenance" sub="Operational levers — most you'll never touch" />

      <div className="card" style={{ padding: 18, marginTop: 14 }}>
        <SettingRow
          label="Backup before update"
          sub="Snapshot the control-plane state and Raft log before applying any version upgrade"
          defaultOn
        />
        <SettingRow
          label="Auto-apply security patches"
          sub="Apply x.y.Z patches automatically during the maintenance window"
          defaultOn
        />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
          <Field label="Maintenance window">
            <input className="input mono" defaultValue="Sun 03:00–05:00 PT" />
          </Field>
          <Field label="Drain timeout">
            <input className="input mono" defaultValue="120s" />
          </Field>
        </div>
      </div>

      <div style={{ height: 18 }} />
      <SectionH title="System actions" />
      <div className="card" style={{ padding: 18, marginTop: 12 }}>
        <ActionRow
          label="Run system check"
          sub="Verify Raft quorum, disk space, certificate validity, registry reachability"
          buttonLabel="Run check"
        />
        <ActionRow
          label="Reset to defaults"
          sub="Restore every setting on this page (and others) to their out-of-the-box values"
          buttonLabel="Reset"
        />
        <ActionRow
          label="Export config (yaml)"
          sub="Download the full cluster configuration as one yaml file — safe to commit"
          buttonLabel={
            <>
              <I.download width={11} height={11} /> Export
            </>
          }
        />
      </div>

      <div style={{ height: 22 }} />
      <SectionH title="Danger zone" />
      <div className="card" style={{ padding: 18, marginTop: 12, borderColor: "var(--err)" }}>
        <DangerRow
          label="Recreate from backup"
          sub="Tear down current state and rebuild from the most recent verified backup. Cluster will be unreachable for ~3 minutes."
          buttonLabel="Recreate"
          onClick={() => setConfirm("recreate")}
        />
        <DangerRow
          label="Force re-elect leader"
          sub="Trigger a Raft leader re-election. Brief blip in scheduler responsiveness."
          buttonLabel="Re-elect"
          onClick={() => setConfirm("reelect")}
        />
      </div>

      {confirm && (
        <ConfirmModal
          kind={confirm}
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            // eslint-disable-next-line no-console
            console.log("[cluster] confirmed", confirm);
            setConfirm(null);
          }}
        />
      )}
    </div>
  );
}

function ActionRow({
  label,
  sub,
  buttonLabel,
}: {
  label: string;
  sub: string;
  buttonLabel: React.ReactNode;
}) {
  return (
    <div className="row gap-3" style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
        <div className="muted" style={{ fontSize: 11 }}>{sub}</div>
      </div>
      <button className="btn sm">{buttonLabel}</button>
    </div>
  );
}

function DangerRow({
  label,
  sub,
  buttonLabel,
  onClick,
}: {
  label: string;
  sub: string;
  buttonLabel: string;
  onClick: () => void;
}) {
  return (
    <div className="row gap-3" style={{ padding: "12px 0", borderTop: "1px solid var(--border)" }}>
      <div style={{ flex: 1 }}>
        <div className="row gap-2" style={{ alignItems: "center" }}>
          <I.warning width={12} height={12} style={{ color: "var(--err)" }} />
          <span style={{ fontSize: 13, fontWeight: 500 }}>{label}</span>
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{sub}</div>
      </div>
      <button
        className="btn sm"
        style={{ background: "var(--err-bg)", color: "var(--err)", borderColor: "var(--err)" }}
        onClick={onClick}
      >
        {buttonLabel}
      </button>
    </div>
  );
}

function ConfirmModal({
  kind,
  onClose,
  onConfirm,
}: {
  kind: "recreate" | "reelect";
  onClose: () => void;
  onConfirm: () => void;
}) {
  const phrase = kind === "recreate" ? "recreate cluster" : "re-elect leader";
  const [typed, setTyped] = useState("");
  const ok = typed.trim() === phrase;
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
      <div onClick={(e) => e.stopPropagation()} className="os-modal" style={{ width: 460 }}>
        <div className="row gap-2 os-modal-h">
          <I.warning width={14} height={14} style={{ color: "var(--err)" }} />
          <span style={{ fontWeight: 600 }}>
            {kind === "recreate" ? "Recreate cluster from backup" : "Force re-elect leader"}
          </span>
          <div style={{ flex: 1 }} />
          <button className="btn ghost icon sm" onClick={onClose}>
            <I.close width={13} height={13} />
          </button>
        </div>
        <div className="col gap-3" style={{ padding: 18 }}>
          <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
            {kind === "recreate"
              ? "This rolls cluster state back to the most recent verified backup. Anything created since that snapshot will be lost. Running services keep their containers but their declared state will reset."
              : "Triggers a Raft re-election. Schedulers will pause for ~5–10 seconds while a new leader is chosen. Existing tasks keep running."}
          </div>
          <Field label={`Type "${phrase}" to confirm`}>
            <input
              className="input mono"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={phrase}
            />
          </Field>
        </div>
        <div className="row gap-2" style={{ padding: 14, borderTop: "1px solid var(--border)" }}>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn"
            disabled={!ok}
            onClick={onConfirm}
            style={
              ok
                ? { background: "var(--err-bg)", color: "var(--err)", borderColor: "var(--err)" }
                : { opacity: 0.5, cursor: "not-allowed" }
            }
          >
            {kind === "recreate" ? "Recreate" : "Re-elect"}
          </button>
        </div>
      </div>
    </div>
  );
}
