// Variables (v3) — Infisical-style overview matrix + per-env tabs + bulk-edit modal.
// Ported from /tmp/anth-design-qP3sS7/otterstack/project/screens3.jsx (EnvVars3, OverviewMatrix,
// PerEnvTable, SyncIntegrations) and screens2.jsx (BulkEditModal helper).

import { useMemo, useState, type ReactNode } from "react";

import { I } from "../icons";
import { ENV_OVERVIEW_KEYS, SYNC_PROVIDERS, type Env, type EnvVar, type SyncProvider } from "../data";
import { Field, SectionH, Switch3 } from "../components/form";

type EnvName = "production" | "staging" | "preview";
type Status = "set" | "missing" | "empty";

const ENVS: EnvName[] = ["production", "staging", "preview"];

export function EnvVars() {
  const [view, setView] = useState<"overview" | EnvName | "sync">("overview");

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "var(--bg)",
      }}
    >
      {/* tab bar */}
      <div className="row" style={{ borderBottom: "1px solid var(--border)", padding: "0 18px", height: 38, gap: 0 }}>
        <EnvTab label="Overview" active={view === "overview"} onClick={() => setView("overview")} icon={I.scale} />
        {ENVS.map((e) => (
          <EnvTab
            key={e}
            label={e[0]!.toUpperCase() + e.slice(1)}
            active={view === e}
            onClick={() => setView(e)}
            badge={e === "production" || e === "staging" ? "17" : null}
          />
        ))}
        <EnvTab label="Sync" active={view === "sync"} onClick={() => setView("sync")} icon={I.sync} />
        <button className="os-envtab" style={{ color: "var(--fg-3)" }}>
          <I.plus width={11} height={11} />
        </button>
        <div style={{ flex: 1 }} />
      </div>

      {view === "overview" && <OverviewMatrix onJump={(env) => setView(env)} />}
      {ENVS.includes(view as EnvName) && <PerEnvTable env={view as EnvName} />}
      {view === "sync" && <SyncIntegrations />}
    </div>
  );
}

function EnvTab({
  label,
  active,
  onClick,
  badge,
  icon: Icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: string | null;
  icon?: (typeof I)[keyof typeof I];
}) {
  return (
    <button onClick={onClick} className="os-envtab" data-active={active}>
      {Icon && <Icon width={12} height={12} style={{ opacity: 0.7 }} />}
      <span>{label}</span>
      {badge && <span className="os-envtab-badge">{badge}</span>}
      <span className="os-envtab-underline" />
    </button>
  );
}

// ────── Overview matrix ──────
function OverviewMatrix({ onJump }: { onJump: (env: EnvName) => void }) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const filtered = ENV_OVERVIEW_KEYS.filter((r) => !q || r.k.toLowerCase().includes(q.toLowerCase()));

  const counts = useMemo(() => {
    const out: Record<EnvName, number> = { production: 0, staging: 0, preview: 0 };
    for (const r of ENV_OVERVIEW_KEYS) {
      for (const e of ENVS) {
        const status = r.status[e];
        if (status === "set" || status === "empty") out[e]++;
      }
    }
    return out;
  }, []);

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((r) => r.k)));
  };

  return (
    <div className="os-scroll" style={{ flex: 1, overflow: "auto", padding: "20px 24px" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        {/* hero row */}
        <div className="row gap-2" style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <I.folder width={18} height={18} style={{ color: "var(--fg-2)" }} />
            <span style={{ fontSize: 18, fontWeight: 600 }}>Project Overview</span>
          </div>
          <div style={{ flex: 1 }} />
          <button className="btn"><I.filter width={12} height={12} /> Filters</button>
          <div className="row gap-2" style={{ position: "relative" }}>
            <I.search
              width={12}
              height={12}
              style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "var(--fg-3)" }}
            />
            <input
              className="input"
              placeholder="Search by secret or folder name…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ paddingLeft: 26, width: 280 }}
            />
          </div>
          <button className="btn primary">
            <I.plus width={12} height={12} /> Add Secret <I.chevDown width={10} height={10} />
          </button>
        </div>

        <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
          Inject secrets via the <span className="mono" style={{ color: "var(--fg-2)" }}>otterstack</span> CLI, runtime API,
          or build-time env-injection. Click <span style={{ color: "var(--fg-2)" }}>Explore</span> on any environment to see
          and edit values.
        </div>

        {/* matrix table */}
        <div className="card os-matrix">
          <div className="os-matrix-head">
            <span style={{ width: 28 }}>
              <input
                type="checkbox"
                checked={selected.size > 0 && selected.size === filtered.length}
                onChange={toggleAll}
                style={{ accentColor: "var(--fg)" }}
              />
            </span>
            <span style={{ flex: 1, display: "flex", alignItems: "center", gap: 4 }}>
              NAME <I.chevDown width={10} height={10} style={{ opacity: 0.5 }} />
            </span>
            <span style={{ width: 28, color: "var(--fg-4)" }}><I.chev width={10} height={10} /></span>
            {ENVS.map((e) => (
              <span key={e} className="os-matrix-env" onClick={() => onJump(e)}>
                <span>{e[0]!.toUpperCase() + e.slice(1)}</span>
                <span className="os-matrix-envcount">{counts[e]}</span>
              </span>
            ))}
          </div>

          {filtered.map((r) => (
            <div key={r.k} className="os-matrix-row">
              <span style={{ width: 28 }}>
                <input
                  type="checkbox"
                  checked={selected.has(r.k)}
                  onChange={() => {
                    setSelected((s) => {
                      const n = new Set(s);
                      if (n.has(r.k)) n.delete(r.k);
                      else n.add(r.k);
                      return n;
                    });
                  }}
                  style={{ accentColor: "var(--fg)" }}
                />
              </span>
              <span style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
                <I.key width={11} height={11} style={{ color: "var(--fg-3)", opacity: 0.7 }} />
                <span className="mono" style={{ fontSize: 12, fontWeight: 500 }}>{r.k}</span>
              </span>
              <span style={{ width: 28 }} />
              {ENVS.map((e) => (
                <span key={e} className="os-matrix-cell">
                  <StatusGlyph status={r.status[e]} />
                </span>
              ))}
            </div>
          ))}

          {/* explore footer row */}
          <div className="os-matrix-row" style={{ borderTop: "1px solid var(--border)", background: "var(--bg-sunken)" }}>
            <span style={{ width: 28 }} />
            <span style={{ flex: 1 }} />
            <span style={{ width: 28 }} />
            {ENVS.map((e) => (
              <span key={e} className="os-matrix-cell">
                <button className="btn sm" onClick={() => onJump(e)} style={{ height: 22, fontSize: 11 }}>
                  <I.link width={10} height={10} /> Explore
                </button>
              </span>
            ))}
          </div>
        </div>

        <div className="row" style={{ marginTop: 10, fontSize: 11, color: "var(--fg-3)" }}>
          <I.key width={11} height={11} />
          <span style={{ marginLeft: 4 }}>{filtered.length}</span>
          <div style={{ flex: 1 }} />
          <span>1 – {filtered.length} of {filtered.length}</span>
          <span style={{ marginLeft: 16, opacity: 0.5 }}>‹‹  ‹  ›  ››</span>
        </div>

        {/* status legend */}
        <div
          className="row gap-3"
          style={{
            marginTop: 18,
            padding: 12,
            fontSize: 11,
            color: "var(--fg-3)",
            border: "1px dashed var(--border)",
            borderRadius: 8,
            background: "var(--bg-sunken)",
          }}
        >
          <span style={{ fontWeight: 500, color: "var(--fg-2)" }}>Legend</span>
          <span className="row gap-1"><StatusGlyph status="set" /> set with value</span>
          <span className="row gap-1"><StatusGlyph status="empty" /> defined, empty</span>
          <span className="row gap-1"><StatusGlyph status="missing" /> not defined in this env</span>
        </div>
      </div>
    </div>
  );
}

function StatusGlyph({ status }: { status: Status }) {
  if (status === "set") return <I.check width={13} height={13} style={{ color: "var(--ok)" }} />;
  if (status === "missing") return <I.x width={13} height={13} style={{ color: "var(--err)" }} />;
  return <I.circle width={11} height={11} style={{ color: "var(--warn)" }} />;
}

// ────── Per-env table ──────
function PerEnvTable({ env }: { env: EnvName }) {
  const [q, setQ] = useState("");
  const [revealAll, setRevealAll] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hovered, setHovered] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  const rows = useMemo(() => {
    return ENV_OVERVIEW_KEYS.map((r) => {
      const status = r.status[env];
      let v: string | null = "";
      if (status === "set") v = r.secret ? "••••••••••••••••••••••••" : sampleValue(r.k, env);
      else if (status === "empty") v = "";
      else v = null;
      return { ...r, v, status };
    }).filter((r) => r.status !== "missing");
  }, [env]);

  const filtered = rows.filter((r) => !q || r.k.toLowerCase().includes(q.toLowerCase()));

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((r) => r.k)));
  };

  return (
    <div className="os-scroll" style={{ flex: 1, overflow: "auto", padding: 20 }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        {/* toolbar */}
        <div className="row gap-2" style={{ marginBottom: 14 }}>
          <div className="row gap-2" style={{ position: "relative", flex: 1, maxWidth: 380 }}>
            <I.search
              width={12}
              height={12}
              style={{
                position: "absolute",
                left: 10,
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--fg-3)",
              }}
            />
            <input
              className="input"
              placeholder="Search by secret, folder, tag or metadata…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ paddingLeft: 28, width: "100%" }}
            />
          </div>
          <button className="btn"><I.filter width={12} height={12} /> Filters</button>
          <div style={{ flex: 1 }} />
          <button className="btn ghost icon"><I.download width={13} height={13} /></button>
          <button className="btn ghost icon" onClick={() => setRevealAll((r) => !r)}>
            <I.eye width={13} height={13} />
          </button>
          <button className="btn" onClick={() => setBulkOpen(true)}>
            <I.copy width={12} height={12} /> Bulk edit
          </button>
          <button className="btn"><I.branch width={12} height={12} /> 3 Commits</button>
          <button className="btn primary">
            <I.plus width={12} height={12} /> Add Secret <I.chevDown width={10} height={10} />
          </button>
        </div>

        {/* table */}
        <div className="card" style={{ overflow: "hidden" }}>
          <div className="os-pe-head">
            <span style={{ width: 32 }}>
              <input
                type="checkbox"
                checked={selected.size > 0 && selected.size === filtered.length}
                onChange={toggleAll}
                style={{ accentColor: "var(--fg)" }}
              />
            </span>
            <span style={{ width: 24 }} />
            <span style={{ flex: 1, display: "flex", alignItems: "center", gap: 4 }}>
              Key <I.chevDown width={9} height={9} style={{ opacity: 0.5 }} />
            </span>
            <span style={{ flex: 2, borderLeft: "1px solid var(--border)", paddingLeft: 12 }}>Value</span>
            <span style={{ width: 200 }} />
          </div>
          {filtered.map((r) => (
            <div
              key={r.k}
              className="os-pe-row"
              onMouseEnter={() => setHovered(r.k)}
              onMouseLeave={() => setHovered(null)}
            >
              <span style={{ width: 32 }}>
                <input
                  type="checkbox"
                  checked={selected.has(r.k)}
                  onChange={() => {
                    setSelected((s) => {
                      const n = new Set(s);
                      if (n.has(r.k)) n.delete(r.k);
                      else n.add(r.k);
                      return n;
                    });
                  }}
                  style={{ accentColor: "var(--fg)" }}
                />
              </span>
              <span style={{ width: 24, color: "var(--fg-4)" }}>
                <I.key width={11} height={11} />
              </span>
              <span style={{ flex: 1 }}>
                <span className="mono" style={{ fontSize: 12, fontWeight: 500 }}>{r.k}</span>
              </span>
              <span style={{ flex: 2, borderLeft: "1px solid var(--border)", paddingLeft: 12, minWidth: 0 }}>
                {r.v === "" ? (
                  <span
                    className="mono"
                    style={{ fontSize: 11, color: "var(--fg-4)", letterSpacing: "0.06em" }}
                  >
                    EMPTY
                  </span>
                ) : (
                  <span
                    className="mono"
                    style={{
                      fontSize: 12,
                      color: r.secret && !revealAll ? "var(--fg-3)" : "var(--fg-2)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      display: "inline-block",
                      maxWidth: "100%",
                    }}
                  >
                    {r.secret && !revealAll ? "••••••••••••••••••••••••••••" : r.v}
                  </span>
                )}
              </span>
              <span
                style={{
                  width: 200,
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 2,
                  opacity: hovered === r.k ? 1 : 0,
                  transition: "opacity 100ms",
                }}
              >
                <button className="btn ghost icon sm" title="Copy"><I.copy width={11} height={11} /></button>
                <button className="btn ghost icon sm" title="Tag"><I.bolt width={11} height={11} /></button>
                <button className="btn ghost icon sm" title="Pin"><I.link width={11} height={11} /></button>
                <button className="btn ghost icon sm" title="History"><I.branch width={11} height={11} /></button>
                <button className="btn ghost icon sm" title="Reference"><I.refresh width={11} height={11} /></button>
                <button className="btn ghost icon sm" title="Move"><I.upload width={11} height={11} /></button>
                <button className="btn ghost icon sm" title="More"><I.more width={11} height={11} /></button>
                <button className="btn ghost icon sm" title="Delete"><I.trash width={11} height={11} /></button>
              </span>
            </div>
          ))}

          {/* footer with count + pagination */}
          <div
            className="row"
            style={{
              padding: "8px 14px",
              borderTop: "1px solid var(--border)",
              fontSize: 11,
              color: "var(--fg-3)",
              background: "var(--bg-sunken)",
            }}
          >
            <I.key width={11} height={11} />
            <span style={{ marginLeft: 4 }}>{filtered.length}</span>
            <div style={{ flex: 1 }} />
            <span className="mono">1 – {filtered.length} of {filtered.length}</span>
            <span className="mono" style={{ marginLeft: 14, opacity: 0.5 }}>‹‹ ‹ › ››</span>
          </div>
        </div>

        {/* drag-drop import zone */}
        <div className="os-import-drop">
          <I.upload width={20} height={20} style={{ color: "var(--fg-3)" }} />
          <div style={{ marginTop: 6, fontSize: 13, color: "var(--fg-2)" }}>
            Drag and drop a <span className="mono">.env</span>, <span className="mono">.json</span>,{" "}
            <span className="mono">.csv</span>, or <span className="mono">.yml</span> file here to add more secrets.
          </div>
          <div style={{ fontSize: 11, color: "var(--fg-4)", margin: "8px 0" }}>OR</div>
          <button className="btn" onClick={() => setBulkOpen(true)}>
            <I.copy width={12} height={12} /> Paste Secrets
          </button>
        </div>
      </div>

      {bulkOpen && <BulkEditModal env={env} rows={rows} onClose={() => setBulkOpen(false)} />}
    </div>
  );
}

function sampleValue(key: string, env: EnvName) {
  const e = env === "preview" ? "dev" : env === "staging" ? "stg" : "prod";
  const samples: Record<string, string> = {
    DATABASE_URL: `postgres://helio:•••@${e}-postgres:5432/helio`,
    BETTER_AUTH_URL: `https://${e === "prod" ? "" : e + "."}helio.so`,
    CORS_ORIGIN: `https://${e === "prod" ? "" : e + "."}helio.so`,
    VITE_SERVER_URL: `https://api.${e === "prod" ? "" : e + "."}helio.so`,
    BETTER_AUTH_SECRET: "sk_••••••••••••••",
    APPLE_APP_BUNDLE_ID: "com.paperhouse.helio",
  };
  return samples[key] || `${key.toLowerCase()}_value`;
}

// ────── Bulk edit modal (helper from screens2/EnvVars2) ──────
interface BulkRow { k: string; v: string | null; secret: boolean }

function BulkEditModal({
  env,
  rows,
  onClose,
}: {
  env: EnvName;
  rows: BulkRow[];
  onClose: () => void;
}) {
  const initial = rows.map((v) => `${v.k}=${v.v ?? ""}`).join("\n");
  const [text, setText] = useState(initial);
  const [target, setTarget] = useState<Set<EnvName>>(new Set([env]));

  const parsed = useMemo<EnvVar[]>(() => {
    const out: EnvVar[] = [];
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 1) continue;
      let k = line.slice(0, eq).trim();
      let v = line.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (k.startsWith("export ")) k = k.slice(7).trim();
      out.push({ k, v, secret: /SECRET|KEY|TOKEN|PASS|DSN/i.test(k) });
    }
    return out;
  }, [text]);

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
        style={{
          width: 760,
          maxHeight: "80vh",
          background: "var(--bg-elev)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          boxShadow: "var(--shadow-lg)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div className="row gap-2" style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>
            Bulk edit ·{" "}
            <span className="mono" style={{ fontWeight: 400, color: "var(--fg-2)" }}>{env}</span>
          </span>
          <span className="muted" style={{ fontSize: 12 }}>Paste a .env, or edit inline</span>
          <div style={{ flex: 1 }} />
          <button className="btn ghost icon sm" onClick={onClose}><I.close width={13} height={13} /></button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", flex: 1, overflow: "hidden" }}>
          {/* editor */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              borderRight: "1px solid var(--border)",
              overflow: "hidden",
            }}
          >
            <div
              className="row gap-2"
              style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)", fontSize: 11 }}
            >
              <span className="muted">.env format · # comments ok · KEY=value</span>
              <div style={{ flex: 1 }} />
              <button
                className="btn sm ghost"
                onClick={() => {
                  navigator.clipboard?.readText().then((t) => setText(t)).catch(() => {});
                }}
              >
                Paste from clipboard
              </button>
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              className="mono"
              style={{
                flex: 1,
                padding: 14,
                background: "var(--bg-sunken)",
                color: "var(--fg)",
                border: 0,
                outline: "none",
                resize: "none",
                fontSize: 12,
                lineHeight: 1.7,
                minHeight: 360,
              }}
            />
          </div>

          {/* sidebar */}
          <div className="col gap-3" style={{ padding: 14, overflow: "auto" }}>
            <div>
              <div
                className="muted"
                style={{
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 6,
                }}
              >
                Apply to
              </div>
              <div className="col gap-1">
                {ENVS.map((e) => (
                  <label key={e} className="row gap-2" style={{ padding: "4px 0", fontSize: 12, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={target.has(e)}
                      onChange={() => {
                        setTarget((s) => {
                          const n = new Set(s);
                          if (n.has(e)) n.delete(e);
                          else n.add(e);
                          return n;
                        });
                      }}
                      style={{ accentColor: "var(--fg)" }}
                    />
                    <span
                      className={`os-env-dot ${e === "production" ? "" : e === "staging" ? "staging" : "preview"}`}
                    />
                    <span>{e}</span>
                  </label>
                ))}
              </div>
            </div>
            <div style={{ height: 1, background: "var(--border)" }} />
            <div>
              <div
                className="muted"
                style={{
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 6,
                }}
              >
                Preview
              </div>
              <div style={{ fontSize: 12, color: "var(--fg-2)" }}>
                <div className="mono">{parsed.length} variables parsed</div>
                <div className="mono" style={{ color: "var(--fg-3)", fontSize: 11, marginTop: 4 }}>
                  {parsed.filter((p) => p.secret).length} marked secret
                </div>
              </div>
            </div>
            <div style={{ height: 1, background: "var(--border)" }} />
            <div>
              <div
                className="muted"
                style={{
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 6,
                }}
              >
                Detected
              </div>
              <div className="mono" style={{ fontSize: 11, color: "var(--fg-2)", maxHeight: 160, overflow: "auto" }}>
                {parsed.slice(0, 10).map((p) => (
                  <div key={p.k} style={{ display: "flex", gap: 6, padding: "2px 0" }}>
                    <span style={{ color: p.secret ? "var(--warn)" : "var(--fg-3)" }}>
                      {p.secret ? "••" : "  "}
                    </span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.k}</span>
                  </div>
                ))}
                {parsed.length > 10 && (
                  <div className="muted" style={{ fontSize: 10 }}>+{parsed.length - 10} more</div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="row gap-2" style={{ padding: 14, borderTop: "1px solid var(--border)" }}>
          <span className="muted" style={{ fontSize: 11 }}>
            Hot-reload to all replicas in {[...target].join(", ") || "(none selected)"}
          </span>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={onClose}>Apply {parsed.length} vars →</button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Sync integrations (sub-tab of EnvVars3)
// ════════════════════════════════════════════════════════════════════════
function SyncIntegrations() {
  const [providers, setProviders] = useState<SyncProvider[]>(SYNC_PROVIDERS);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="os-scroll" style={{ flex: 1, overflow: "auto", padding: 24 }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div className="row" style={{ marginBottom: 6 }}>
          <SectionH
            title="Sync sources"
            sub="Pull secrets from an external manager into any environment · changes flow one-way"
          />
          <div style={{ flex: 1 }} />
          <button className="btn"><I.doc width={12} height={12} /> Read docs</button>
        </div>

        {/* connected summary */}
        <div className="row gap-3" style={{ marginTop: 14, marginBottom: 18 }}>
          {[
            { label: "connected", n: providers.filter((p) => p.connected).length, total: providers.length, sub: "" },
            { label: "syncing", n: providers.filter((p) => p.connected).length, sub: "every 60s" },
            { label: "last sync", val: "2m ago", sub: "all sources up-to-date" },
          ].map((s, i) => (
            <div key={i} className="card" style={{ flex: 1, padding: 14 }}>
              <div
                className="muted"
                style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}
              >
                {s.label}
              </div>
              <div className="mono" style={{ fontSize: 22, fontWeight: 500, marginTop: 4 }}>
                {"val" in s && s.val
                  ? s.val
                  : `${(s as { n: number }).n}${"total" in s && s.total ? ` / ${s.total}` : ""}`}
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{s.sub || " "}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {providers.map((p) => (
            <ProviderCard
              key={p.id}
              p={p}
              onConfigure={() => setOpenId(p.id)}
              onConnect={() =>
                setProviders((ps) =>
                  ps.map((x) =>
                    x.id === p.id
                      ? { ...x, connected: true, last: "just now", count: 0, env: "production" as Env }
                      : x,
                  ),
                )
              }
              onDisconnect={() =>
                setProviders((ps) =>
                  ps.map((x) =>
                    x.id === p.id
                      ? { ...x, connected: false, last: undefined, count: undefined }
                      : x,
                  ),
                )
              }
            />
          ))}
        </div>
      </div>

      {openId && (
        <ProviderModal
          p={providers.find((x) => x.id === openId)!}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

function ProviderCard({
  p,
  onConfigure,
  onConnect,
  onDisconnect,
}: {
  p: SyncProvider;
  onConfigure: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const Logo = providerLogo(p.id);
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="row gap-3">
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 8,
            background: "var(--bg-sunken)",
            border: "1px solid var(--border)",
            display: "grid",
            placeItems: "center",
          }}
        >
          {Logo}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row gap-2">
            <span style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</span>
            {p.connected ? (
              <span className="badge ok"><span className="dot" />connected</span>
            ) : (
              <span className="badge"><span className="dot" style={{ background: "var(--fg-4)" }} />not connected</span>
            )}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{p.sub}</div>
        </div>
      </div>

      {p.connected && (
        <div
          className="row gap-3"
          style={{ padding: "12px 0", marginTop: 12, borderTop: "1px solid var(--border)", fontSize: 11 }}
        >
          <Stat label="last sync" value={p.last ?? ""} />
          <Stat label="syncing" value={`${p.count ?? 0} secrets`} />
          <Stat
            label="target env"
            value={
              <>
                <span
                  className={`os-env-dot ${p.env === "production" ? "" : p.env === "staging" ? "staging" : "preview"}`}
                />{" "}
                {p.env}
              </>
            }
          />
        </div>
      )}

      <div className="row gap-2" style={{ marginTop: p.connected ? 6 : 14 }}>
        {p.connected ? (
          <>
            <button className="btn sm" onClick={onConfigure}><I.settings width={11} height={11} /> Configure</button>
            <button className="btn sm"><I.sync width={11} height={11} /> Sync now</button>
            <div style={{ flex: 1 }} />
            <button className="btn sm ghost" onClick={onDisconnect} style={{ color: "var(--err)" }}>
              Disconnect
            </button>
          </>
        ) : (
          <>
            <button className="btn sm primary" onClick={onConnect}><I.link width={11} height={11} /> Connect</button>
            <button className="btn sm ghost"><I.doc width={11} height={11} /> Setup guide</button>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </div>
      <div
        className="mono"
        style={{
          fontSize: 12,
          marginTop: 2,
          color: "var(--fg-2)",
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function providerLogo(id: string): ReactNode {
  const style = { width: 22, height: 22 } as const;
  if (id === "infisical")
    return (
      <div
        className="mono"
        style={{ ...style, background: "#facc15", color: "#000", display: "grid", placeItems: "center", borderRadius: 4, fontWeight: 700, fontSize: 11 }}
      >
        i
      </div>
    );
  if (id === "vault")
    return (
      <div
        className="mono"
        style={{ ...style, background: "#000", color: "#fadc4f", display: "grid", placeItems: "center", borderRadius: 4, fontWeight: 700, fontSize: 11 }}
      >
        V
      </div>
    );
  if (id === "aws-sm")
    return (
      <div
        className="mono"
        style={{ ...style, background: "#232f3e", color: "#ff9900", display: "grid", placeItems: "center", borderRadius: 4, fontWeight: 700, fontSize: 9 }}
      >
        aws
      </div>
    );
  if (id === "doppler")
    return (
      <div
        className="mono"
        style={{ ...style, background: "#3461ff", color: "#fff", display: "grid", placeItems: "center", borderRadius: 4, fontWeight: 700, fontSize: 12 }}
      >
        D
      </div>
    );
  if (id === "1password")
    return (
      <div
        className="mono"
        style={{ ...style, background: "#0572ec", color: "#fff", display: "grid", placeItems: "center", borderRadius: "50%", fontWeight: 700, fontSize: 10 }}
      >
        1
      </div>
    );
  if (id === "gcp-sm")
    return (
      <div
        className="mono"
        style={{ ...style, background: "#fff", color: "#1a73e8", border: "1px solid #1a73e8", display: "grid", placeItems: "center", borderRadius: 4, fontWeight: 700, fontSize: 9 }}
      >
        GCP
      </div>
    );
  return <I.globe width={16} height={16} />;
}

function ProviderModal({ p, onClose }: { p: SyncProvider; onClose: () => void }) {
  const [step, setStep] = useState<"auth" | "config">(p.connected ? "config" : "auth");
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
        style={{
          width: 600,
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-elev)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          boxShadow: "var(--shadow-lg)",
          overflow: "hidden",
        }}
      >
        <div className="row gap-2" style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 5,
              background: "var(--bg-sunken)",
              display: "grid",
              placeItems: "center",
              border: "1px solid var(--border)",
            }}
          >
            {providerLogo(p.id)}
          </div>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Configure {p.name}</span>
          <span className="muted" style={{ fontSize: 11 }}>· {step === "auth" ? "authenticate" : "mappings"}</span>
          <div style={{ flex: 1 }} />
          <button className="btn ghost icon sm" onClick={onClose}><I.close width={13} height={13} /></button>
        </div>

        <div style={{ padding: 20, overflow: "auto", flex: 1 }}>
          {step === "auth" && (
            <div className="col gap-3">
              <div className="muted" style={{ fontSize: 12 }}>
                Provide credentials. They are stored encrypted at rest using the project's KMS key.
              </div>
              <Field
                label={
                  p.id === "infisical" ? "Site URL" : p.id === "vault" ? "Vault address" : "Endpoint"
                }
              >
                <input
                  className="input mono"
                  defaultValue={
                    p.id === "infisical"
                      ? "https://app.infisical.com"
                      : p.id === "vault"
                        ? "https://vault.paperhouse.dev:8200"
                        : ""
                  }
                  placeholder="https://…"
                />
              </Field>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field
                  label={p.id === "infisical" ? "Client ID" : p.id === "aws-sm" ? "Access key" : "Token / role ID"}
                >
                  <input className="input mono" placeholder="…" />
                </Field>
                <Field
                  label={p.id === "infisical" ? "Client secret" : p.id === "aws-sm" ? "Secret key" : "Secret ID"}
                >
                  <input className="input mono" type="password" placeholder="…" />
                </Field>
              </div>
              {p.id === "infisical" && (
                <Field label="Project / workspace ID">
                  <input className="input mono" placeholder="ws_…" />
                </Field>
              )}
              {p.id === "vault" && (
                <Field label="Mount path">
                  <input className="input mono" defaultValue="kv/data/helio" />
                </Field>
              )}
              {p.id === "aws-sm" && (
                <Field label="Region">
                  <select className="input mono">
                    <option>us-west-2</option>
                    <option>us-east-1</option>
                    <option>eu-central-1</option>
                  </select>
                </Field>
              )}
            </div>
          )}

          {step === "config" && (
            <div className="col gap-3">
              <div className="muted" style={{ fontSize: 12 }}>
                Map remote secret paths to Otterstack environments. Sync runs every 60 seconds; conflicts surface as
                warnings — Otterstack never overwrites a value you set manually.
              </div>
              {(["production", "staging", "preview"] as const).map((env) => (
                <div key={env} className="card" style={{ padding: 12 }}>
                  <div className="row gap-2" style={{ marginBottom: 8 }}>
                    <span
                      className={`os-env-dot ${env === "production" ? "" : env === "staging" ? "staging" : "preview"}`}
                    />
                    <span style={{ fontWeight: 500, fontSize: 13 }}>{env}</span>
                    <div style={{ flex: 1 }} />
                    <Switch3 on={env !== "preview"} />
                  </div>
                  <div className="row gap-2">
                    <input className="input mono" defaultValue={`/helio/${env}/*`} style={{ flex: 1 }} />
                    <span className="muted">→</span>
                    <input className="input mono" defaultValue={`*`} style={{ flex: 1 }} />
                  </div>
                </div>
              ))}
              <div className="row gap-2">
                <span className="muted" style={{ fontSize: 11 }}>On conflict</span>
                <select className="input" style={{ width: 200 }}>
                  <option>Skip — keep local value</option>
                  <option>Overwrite local with remote</option>
                  <option>Warn and require approval</option>
                </select>
              </div>
            </div>
          )}
        </div>

        <div className="row gap-2" style={{ padding: 14, borderTop: "1px solid var(--border)" }}>
          <button className="btn ghost"><I.doc width={11} height={11} /> Setup guide</button>
          <div style={{ flex: 1 }} />
          {step === "auth" && <button className="btn" onClick={onClose}>Cancel</button>}
          {step === "auth" && (
            <button className="btn primary" onClick={() => setStep("config")}>Continue →</button>
          )}
          {step === "config" && (
            <button className="btn" onClick={() => setStep("auth")}>← Back</button>
          )}
          {step === "config" && (
            <button className="btn primary" onClick={onClose}>Save sync config</button>
          )}
        </div>
      </div>
    </div>
  );
}
