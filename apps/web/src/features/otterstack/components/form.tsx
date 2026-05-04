// Shared form / settings helpers — ported from screens3.jsx prototype.
// Used by env, networking, and settings screens.

import { useState, type ReactNode } from "react";

import { I } from "../icons";
import { BUILDERS } from "../data";

// ────────── SectionH ──────────
export function SectionH({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ marginBottom: 10, display: "flex", alignItems: "baseline", gap: 10 }}>
      <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, letterSpacing: "0.01em" }}>{title}</h3>
      {sub && <span className="muted" style={{ fontSize: 12 }}>{sub}</span>}
    </div>
  );
}

// ────────── Field ──────────
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="col gap-1">
      <span className="muted" style={{ fontSize: 11 }}>{label}</span>
      {children}
    </label>
  );
}

// ────────── Switch3 ──────────
export function Switch3({ on, onChange }: { on: boolean; onChange?: (v: boolean) => void }) {
  const [v, setV] = useState(on);
  return (
    <button
      onClick={() => {
        const n = !v;
        setV(n);
        onChange?.(n);
      }}
      style={{
        width: 28,
        height: 16,
        borderRadius: 999,
        background: v ? "var(--fg)" : "var(--border-strong)",
        position: "relative",
        cursor: "pointer",
        border: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: v ? 14 : 2,
          width: 12,
          height: 12,
          borderRadius: "50%",
          background: "var(--bg-elev)",
          transition: "left 140ms",
        }}
      />
    </button>
  );
}

// ────────── SettingRow ──────────
export function SettingRow({
  label,
  sub,
  defaultOn,
}: {
  label: string;
  sub?: string;
  defaultOn?: boolean;
}) {
  const [on, setOn] = useState(!!defaultOn);
  return (
    <div className="row gap-3" style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
        {sub && <div className="muted" style={{ fontSize: 11 }}>{sub}</div>}
      </div>
      <Switch3 on={on} onChange={setOn} />
    </div>
  );
}

// ────────── BuilderConfig ──────────
function BuilderIcon({ icon, width = 14, height = 14 }: { icon: string; width?: number; height?: number }) {
  const dict = I as unknown as Record<string, (typeof I)[keyof typeof I] | undefined>;
  const Comp = dict[icon];
  if (Comp) return <Comp width={width} height={height} />;
  return <I.doc width={width} height={height} />;
}

export function BuilderConfig({ builderId, service }: { builderId: string; service: string }) {
  if (builderId === "railpack") {
    return (
      <div className="card" style={{ padding: 18 }}>
        <div className="row gap-2" style={{ marginBottom: 4 }}>
          <I.bolt width={14} height={14} style={{ color: "var(--fg-2)" }} />
          <span style={{ fontWeight: 600, fontSize: 13 }}>Railpack auto-detect</span>
          <span className="badge ok"><span className="dot" />Node 20 detected</span>
        </div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 14 }}>
          Railpack inspects your repo and assembles an OCI image automatically. Override individual layers below if needed.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Install command (override)">
            <input className="input mono" placeholder="auto: pnpm install --frozen-lockfile" />
          </Field>
          <Field label="Build command (override)">
            <input className="input mono" placeholder={service === "web" ? "auto: pnpm build" : "auto: tsc -p ."} />
          </Field>
        </div>
        <div style={{ height: 10 }} />
        <Field label="Root directory">
          <input className="input mono" defaultValue={`apps/${service}`} />
        </Field>
        <div style={{ height: 12 }} />
        <div className="muted" style={{ fontSize: 11 }}>Detected layers</div>
        <div className="card" style={{ padding: 10, marginTop: 6, background: "var(--bg-sunken)" }}>
          <div className="mono" style={{ fontSize: 11, lineHeight: 1.8, color: "var(--fg-2)" }}>
            <div>1. <span style={{ color: "var(--info)" }}>setup</span>     · alpine + corepack</div>
            <div>2. <span style={{ color: "var(--info)" }}>install</span>   · pnpm install --frozen-lockfile</div>
            <div>3. <span style={{ color: "var(--info)" }}>build</span>     · pnpm --filter ./apps/{service} build</div>
            <div>4. <span style={{ color: "var(--info)" }}>runtime</span>   · gcr.io/distroless/nodejs20-debian12</div>
          </div>
        </div>
      </div>
    );
  }
  if (builderId === "dockerfile") {
    return (
      <div className="card" style={{ padding: 18 }}>
        <div className="row gap-2" style={{ marginBottom: 8 }}>
          <I.doc width={14} height={14} style={{ color: "var(--fg-2)" }} />
          <span style={{ fontWeight: 600, fontSize: 13 }}>Dockerfile</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Dockerfile path"><input className="input mono" defaultValue={`apps/${service}/Dockerfile`} /></Field>
          <Field label="Build context"><input className="input mono" defaultValue="." /></Field>
        </div>
        <div style={{ height: 10 }} />
        <Field label="Target stage (multi-stage)">
          <input className="input mono" placeholder="optional · e.g. runtime" />
        </Field>
        <div style={{ height: 10 }} />
        <Field label="Build args (one per line, KEY=value)">
          <textarea className="input mono" rows={3} defaultValue={`NODE_VERSION=20\nGIT_SHA=$COMMIT_SHA`} />
        </Field>
      </div>
    );
  }
  if (builderId === "compose") {
    return (
      <div className="card" style={{ padding: 18 }}>
        <div className="row gap-2" style={{ marginBottom: 8 }}>
          <I.service width={14} height={14} style={{ color: "var(--fg-2)" }} />
          <span style={{ fontWeight: 600, fontSize: 13 }}>Docker Compose</span>
          <span className="badge"><I.warning width={9} height={9} /> deploys all services in compose.yml as a Docker Stack</span>
        </div>
        <Field label="Compose file"><input className="input mono" defaultValue="compose.yml" /></Field>
        <div style={{ height: 10 }} />
        <Field label="Profiles (comma separated)">
          <input className="input mono" placeholder="prod, observability" />
        </Field>
        <div style={{ height: 12 }} />
        <div className="muted" style={{ fontSize: 11 }}>Detected services</div>
        <div className="card" style={{ padding: 10, marginTop: 6, background: "var(--bg-sunken)" }}>
          <div className="mono" style={{ fontSize: 11, lineHeight: 1.8 }}>
            web (build: ./apps/web) · api (build: ./apps/api) · worker (build: ./apps/worker) · postgres:16 · redis:7
          </div>
        </div>
      </div>
    );
  }
  if (builderId === "buildpack") {
    return (
      <div className="card" style={{ padding: 18 }}>
        <div className="row gap-2" style={{ marginBottom: 8 }}>
          <I.folder width={14} height={14} />
          <span style={{ fontWeight: 600, fontSize: 13 }}>Cloud-Native Buildpacks</span>
        </div>
        <Field label="Builder image">
          <select className="input">
            <option>paketobuildpacks/builder-jammy-base:latest</option>
            <option>heroku/builder:24</option>
            <option>gcr.io/buildpacks/builder:v1</option>
          </select>
        </Field>
        <div style={{ height: 10 }} />
        <Field label="Buildpacks (in order)">
          <textarea
            className="input mono"
            rows={3}
            defaultValue={`paketo-buildpacks/nodejs\npaketo-buildpacks/npm-install\npaketo-buildpacks/npm-start`}
          />
        </Field>
      </div>
    );
  }
  if (builderId === "nixpack") {
    return (
      <div className="card" style={{ padding: 18 }}>
        <div className="row gap-2" style={{ marginBottom: 8 }}>
          <I.graph width={14} height={14} />
          <span style={{ fontWeight: 600, fontSize: 13 }}>Nixpacks</span>
        </div>
        <Field label="Nixpacks providers (comma separated)">
          <input className="input mono" defaultValue="node, pnpm" />
        </Field>
        <div style={{ height: 10 }} />
        <Field label="Custom nixpacks.toml">
          <textarea
            className="input mono"
            rows={5}
            defaultValue={`[phases.setup]\nnixPkgs = ['nodejs_20', 'pnpm']\n\n[phases.build]\ncmds = ['pnpm build']`}
          />
        </Field>
      </div>
    );
  }
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="row gap-2"><I.globe width={14} height={14} /> <span style={{ fontWeight: 600, fontSize: 13 }}>Static site</span></div>
      <div style={{ height: 10 }} />
      <Field label="Build command"><input className="input mono" defaultValue="pnpm build" /></Field>
      <div style={{ height: 10 }} />
      <Field label="Output directory"><input className="input mono" defaultValue="dist" /></Field>
    </div>
  );
}

// ────────── BuilderCard (factored for re-use in BuildSettings) ──────────
export function BuilderCard({
  builder,
  active,
  onClick,
}: {
  builder: (typeof BUILDERS)[number];
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} className={`os-builder ${active ? "active" : ""}`}>
      {builder.popular && <span className="os-builder-pop">popular</span>}
      <div className="row gap-2">
        <div className="os-builder-icon"><BuilderIcon icon={builder.icon} /></div>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{builder.name}</span>
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 4, lineHeight: 1.4 }}>{builder.sub}</div>
      {builder.langs && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 8 }}>
          {builder.langs.slice(0, 5).map((l) => (
            <span
              key={l}
              className="mono"
              style={{ fontSize: 10, padding: "1px 6px", borderRadius: 3, background: "var(--bg-overlay)", color: "var(--fg-3)" }}
            >
              {l}
            </span>
          ))}
          {builder.langs.length > 5 && (
            <span className="mono" style={{ fontSize: 10, color: "var(--fg-4)" }}>+{builder.langs.length - 5}</span>
          )}
        </div>
      )}
    </button>
  );
}
