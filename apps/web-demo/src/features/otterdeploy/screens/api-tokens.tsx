// API tokens — personal access tokens for the otterdeploy CLI and CI integrations.
// Tokens are shown once at creation; the success modal is the only place the
// raw secret is rendered. Below the table sits a tiny per-token sparkline.

import * as React from "react";
import { useEffect, useMemo, useState } from "react";

import { I } from "../icons";

type Scope =
  | "read:projects"
  | "write:services"
  | "admin:cluster"
  | "read:logs"
  | "write:env"
  | "admin:databases"
  | "read:metrics"
  | "write:networking"
  | "admin:servers"
  | "write:backups";

type TokenStatus = "active" | "revoked" | "expired";

interface Token {
  id: string;
  name: string;
  scopes: Scope[];
  prefix: string;
  createdAbs: string;
  createdRel: string;
  lastUsedRel: string;
  lastUsedIp: string;
  lastUsedGeo: string;
  expires: string;
  status: TokenStatus;
  /** 24h request series, length 24, 0–100. */
  series: number[];
}

const ALL_SCOPES: { id: Scope; group: string; label: string }[] = [
  { id: "read:projects", group: "Projects", label: "read:projects" },
  { id: "write:services", group: "Services", label: "write:services" },
  { id: "read:logs", group: "Services", label: "read:logs" },
  { id: "write:env", group: "Services", label: "write:env" },
  { id: "admin:databases", group: "Databases", label: "admin:databases" },
  { id: "write:networking", group: "Networking", label: "write:networking" },
  { id: "admin:servers", group: "Servers", label: "admin:servers" },
  { id: "write:backups", group: "Backups", label: "write:backups" },
  { id: "admin:cluster", group: "Cluster", label: "admin:cluster" },
  { id: "read:metrics", group: "Cluster", label: "read:metrics" },
];

const SCOPE_GROUPS = ["Projects", "Services", "Databases", "Networking", "Servers", "Backups", "Cluster"];

const seed = (n: number, max = 100) =>
  Array.from({ length: 24 }, (_, i) => Math.round(((Math.sin(n + i * 0.7) + 1) / 2) * max));

const INITIAL: Token[] = [
  {
    id: "tk_ci",
    name: "paperhouse-ci",
    scopes: ["read:projects", "write:services", "read:logs"],
    prefix: "osk_live_a8f2cd9e",
    createdAbs: "2025-09-04 11:42 UTC",
    createdRel: "62d ago",
    lastUsedRel: "4m ago",
    lastUsedIp: "24.2.1.4",
    lastUsedGeo: "San Francisco",
    expires: "2026-09-04",
    status: "active",
    series: seed(1, 90),
  },
  {
    id: "tk_mira",
    name: "Mira's CLI",
    scopes: ["read:projects", "write:services", "write:env", "read:logs", "read:metrics"],
    prefix: "osk_live_b1d402aa",
    createdAbs: "2025-08-21 09:12 UTC",
    createdRel: "76d ago",
    lastUsedRel: "1h ago",
    lastUsedIp: "98.143.22.187",
    lastUsedGeo: "Oakland",
    expires: "never",
    status: "active",
    series: seed(2, 60),
  },
  {
    id: "tk_old",
    name: "old-deploy-bot",
    scopes: ["write:services"],
    prefix: "osk_live_77c1129a",
    createdAbs: "2024-12-04 18:00 UTC",
    createdRel: "5mo ago",
    lastUsedRel: "31d ago",
    lastUsedIp: "10.0.4.11",
    lastUsedGeo: "internal",
    expires: "2025-04-04",
    status: "expired",
    series: seed(3, 10),
  },
  {
    id: "tk_rev",
    name: "leaked-laptop-key",
    scopes: ["admin:cluster"],
    prefix: "osk_live_44ab90fe",
    createdAbs: "2025-07-12 14:31 UTC",
    createdRel: "3mo ago",
    lastUsedRel: "revoked",
    lastUsedIp: "—",
    lastUsedGeo: "—",
    expires: "—",
    status: "revoked",
    series: seed(4, 5),
  },
  {
    id: "tk_admin",
    name: "ops-cluster-admin",
    scopes: [
      "read:projects",
      "write:services",
      "write:env",
      "admin:databases",
      "write:networking",
      "admin:servers",
      "write:backups",
      "admin:cluster",
      "read:metrics",
      "read:logs",
    ],
    prefix: "osk_live_e9f1aa23",
    createdAbs: "2025-09-19 22:01 UTC",
    createdRel: "47d ago",
    lastUsedRel: "12s ago",
    lastUsedIp: "10.0.4.11",
    lastUsedGeo: "sf-bay (rack-2)",
    expires: "2026-03-19",
    status: "active",
    series: seed(5, 100),
  },
  {
    id: "tk_ro",
    name: "grafana-readonly",
    scopes: ["read:projects", "read:metrics", "read:logs"],
    prefix: "osk_live_22ccd012",
    createdAbs: "2025-10-30 08:15 UTC",
    createdRel: "5d ago",
    lastUsedRel: "3m ago",
    lastUsedIp: "10.0.4.13",
    lastUsedGeo: "sf-bay (rack-2)",
    expires: "2026-10-30",
    status: "active",
    series: seed(6, 40),
  },
];

export function ApiTokens() {
  const [tokens, setTokens] = useState<Token[]>(INITIAL);
  const [createOpen, setCreateOpen] = useState(false);
  const [created, setCreated] = useState<{ token: Token; secret: string } | null>(null);

  const revoke = (id: string) =>
    setTokens((ts) => ts.map((t) => (t.id === id ? { ...t, status: "revoked" } : t)));
  const remove = (id: string) => setTokens((ts) => ts.filter((t) => t.id !== id));
  const rotate = (id: string) => {
    const t = tokens.find((x) => x.id === id);
    if (!t) return;
    const fresh = `osk_live_${Math.random().toString(36).slice(2, 10)}_${Math.random().toString(36).slice(2, 18)}`;
    setTokens((ts) =>
      ts.map((x) =>
        x.id === id ? { ...x, prefix: fresh.slice(0, 18), createdRel: "just now", createdAbs: "now" } : x,
      ),
    );
    setCreated({ token: { ...t, prefix: fresh.slice(0, 18) }, secret: fresh });
  };

  const onCreate = (name: string, scopes: Scope[], expiry: string) => {
    const fresh = `osk_live_${Math.random().toString(36).slice(2, 10)}_${Math.random().toString(36).slice(2, 18)}`;
    const tk: Token = {
      id: `tk_${Math.random().toString(36).slice(2, 6)}`,
      name,
      scopes,
      prefix: fresh.slice(0, 18),
      createdAbs: "just now",
      createdRel: "just now",
      lastUsedRel: "never",
      lastUsedIp: "—",
      lastUsedGeo: "—",
      expires: expiry,
      status: "active",
      series: seed(Math.random() * 10, 20),
    };
    setTokens((ts) => [tk, ...ts]);
    setCreateOpen(false);
    setCreated({ token: tk, secret: fresh });
  };

  return (
    <div className="os-scroll" style={{ flex: 1, overflow: "auto", padding: 24 }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div className="row" style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>API tokens</h3>
            <span className="muted" style={{ fontSize: 12 }}>
              Personal access tokens for the otterdeploy CLI and CI integrations.
            </span>
          </div>
          <div style={{ flex: 1 }} />
          <button className="btn primary" onClick={() => setCreateOpen(true)}>
            <I.plus width={11} height={11} /> Create token
          </button>
        </div>

        <div
          className="row gap-2"
          style={{
            padding: "10px 14px",
            background: "var(--info-bg)",
            border: "1px solid color-mix(in srgb, var(--info) 30%, transparent)",
            borderRadius: 6,
            marginBottom: 16,
            fontSize: 12,
            color: "var(--info)",
          }}
        >
          <I.warning width={12} height={12} />
          <span>
            Tokens are shown once at creation. Store them securely — they cannot be recovered.
          </span>
        </div>

        <div className="card" style={{ overflow: "hidden", marginBottom: 16 }}>
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
            <span style={{ width: 160 }}>Name</span>
            <span style={{ flex: 1 }}>Scopes</span>
            <span style={{ width: 170 }}>Prefix</span>
            <span style={{ width: 110 }}>Created</span>
            <span style={{ width: 180 }}>Last used</span>
            <span style={{ width: 100 }}>Expires</span>
            <span style={{ width: 80 }}>Status</span>
            <span style={{ width: 36 }} />
          </div>
          {tokens.map((t, i) => (
            <TokenRow
              key={t.id}
              t={t}
              borderTop={i > 0}
              onRotate={() => rotate(t.id)}
              onRevoke={() => revoke(t.id)}
              onDelete={() => remove(t.id)}
            />
          ))}
        </div>

        <div className="card" style={{ padding: 14 }}>
          <div className="row" style={{ marginBottom: 10 }}>
            <div
              className="muted"
              style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}
            >
              Requests · last 24h
            </div>
            <div style={{ flex: 1 }} />
            <span className="muted" style={{ fontSize: 11 }}>
              hourly buckets
            </span>
          </div>
          <div className="col gap-2">
            {tokens.map((t) => (
              <div key={t.id} className="row gap-2" style={{ alignItems: "center" }}>
                <span className="mono" style={{ width: 160, fontSize: 11, color: "var(--fg-2)" }}>
                  {t.name}
                </span>
                <Sparkline series={t.series} dimmed={t.status !== "active"} />
                <span className="mono muted" style={{ width: 60, textAlign: "right", fontSize: 11 }}>
                  {t.series.reduce((a, b) => a + b, 0)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {createOpen && <CreateTokenModal onClose={() => setCreateOpen(false)} onCreate={onCreate} />}
      {created && <CreatedModal token={created.token} secret={created.secret} onClose={() => setCreated(null)} />}
    </div>
  );
}

function TokenRow({
  t,
  borderTop,
  onRotate,
  onRevoke,
  onDelete,
}: {
  t: Token;
  borderTop: boolean;
  onRotate: () => void;
  onRevoke: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const dim = t.status !== "active";

  return (
    <div
      className="row"
      style={{
        padding: "12px 14px",
        borderTop: borderTop ? "1px solid var(--border)" : "none",
        fontSize: 12,
        opacity: dim ? 0.65 : 1,
        position: "relative",
      }}
    >
      <span style={{ width: 160, fontWeight: 500 }}>
        <I.key width={11} height={11} style={{ color: "var(--fg-3)", marginRight: 6 }} />
        {t.name}
      </span>
      <span style={{ flex: 1, paddingRight: 10 }}>
        <div className="row gap-1" style={{ flexWrap: "wrap" }}>
          {t.scopes.slice(0, 4).map((s) => (
            <ScopeChip key={s} scope={s} />
          ))}
          {t.scopes.length > 4 && (
            <span className="mono muted" style={{ fontSize: 10 }}>
              +{t.scopes.length - 4}
            </span>
          )}
        </div>
      </span>
      <span className="mono" style={{ width: 170, fontSize: 11, color: "var(--fg-2)" }}>
        {t.prefix}…
      </span>
      <span style={{ width: 110, fontSize: 11 }} title={t.createdAbs}>
        <span style={{ color: "var(--fg-2)" }}>{t.createdRel}</span>
      </span>
      <span style={{ width: 180, fontSize: 11 }}>
        <div style={{ color: "var(--fg-2)" }}>{t.lastUsedRel}</div>
        <div className="muted" style={{ fontSize: 10 }}>
          {t.lastUsedIp !== "—" ? `from ${t.lastUsedIp} — ${t.lastUsedGeo}` : "—"}
        </div>
      </span>
      <span className="mono" style={{ width: 100, fontSize: 11, color: "var(--fg-2)" }}>
        {t.expires}
      </span>
      <span style={{ width: 80 }}>
        <span
          className={`badge ${
            t.status === "active" ? "ok" : t.status === "expired" ? "warn" : "err"
          }`}
        >
          <span className="dot" />
          {t.status}
        </span>
      </span>
      <span style={{ width: 36, textAlign: "right" }}>
        <button className="btn ghost icon sm" onClick={() => setMenuOpen((o) => !o)}>
          <I.more width={12} height={12} />
        </button>
        {menuOpen && (
          <>
            <div
              onClick={() => setMenuOpen(false)}
              style={{ position: "fixed", inset: 0, zIndex: 50 }}
            />
            <div
              style={{
                position: "absolute",
                top: 36,
                right: 14,
                background: "var(--bg-elev)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                boxShadow: "var(--shadow-md)",
                minWidth: 160,
                zIndex: 60,
                padding: 4,
              }}
            >
              <MenuItem
                disabled={t.status !== "active"}
                onClick={() => {
                  setMenuOpen(false);
                  onRotate();
                }}
              >
                <I.refresh width={11} height={11} /> Rotate
              </MenuItem>
              <MenuItem
                disabled={t.status !== "active"}
                onClick={() => {
                  setMenuOpen(false);
                  onRevoke();
                }}
              >
                <I.lock width={11} height={11} /> Revoke
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setMenuOpen(false);
                  onDelete();
                }}
                danger
              >
                <I.trash width={11} height={11} /> Delete
              </MenuItem>
            </div>
          </>
        )}
      </span>
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        padding: "6px 10px",
        background: "transparent",
        border: 0,
        fontSize: 12,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        borderRadius: 4,
        color: danger ? "var(--err)" : "var(--fg-2)",
        textAlign: "left",
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = "var(--bg-overlay)";
      }}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {children}
    </button>
  );
}

function ScopeChip({ scope }: { scope: Scope }) {
  const isAdmin = scope.startsWith("admin:");
  const isWrite = scope.startsWith("write:");
  const color = isAdmin ? "var(--err)" : isWrite ? "var(--warn)" : "var(--info)";
  const bg = isAdmin
    ? "color-mix(in srgb, var(--err) 14%, transparent)"
    : isWrite
      ? "color-mix(in srgb, var(--warn) 14%, transparent)"
      : "var(--info-bg)";
  return (
    <span
      className="mono"
      style={{
        fontSize: 10,
        padding: "1px 5px",
        borderRadius: 3,
        background: bg,
        color,
      }}
    >
      {scope}
    </span>
  );
}

function Sparkline({ series, dimmed }: { series: number[]; dimmed?: boolean }) {
  const w = 360;
  const h = 24;
  const max = Math.max(...series, 1);
  const step = w / (series.length - 1);
  const path = series
    .map((v, i) => `${i === 0 ? "M" : "L"} ${i * step} ${h - (v / max) * h}`)
    .join(" ");
  return (
    <svg width={w} height={h} style={{ flex: 1, opacity: dimmed ? 0.3 : 1 }}>
      <path d={path} fill="none" stroke="var(--fg-2)" strokeWidth={1} />
      <path
        d={`${path} L ${w} ${h} L 0 ${h} Z`}
        fill="var(--fg)"
        opacity={0.06}
      />
    </svg>
  );
}

function CreateTokenModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, scopes: Scope[], expiry: string) => void;
}) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Scope[]>(["read:projects"]);
  const [expiry, setExpiry] = useState("90d");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggle = (s: Scope) =>
    setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  const expiryDate = useMemo(() => {
    if (expiry === "never") return "never";
    const days = parseInt(expiry, 10);
    const d = new Date(Date.now() + days * 86400000);
    return d.toISOString().slice(0, 10);
  }, [expiry]);

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
      <div onClick={(e) => e.stopPropagation()} className="os-modal" style={{ width: 560 }}>
        <div className="row gap-2 os-modal-h">
          <I.key width={14} height={14} />
          <span style={{ fontWeight: 600 }}>Create API token</span>
          <div style={{ flex: 1 }} />
          <button className="btn ghost icon sm" onClick={onClose}>
            <I.close width={13} height={13} />
          </button>
        </div>

        <div className="col gap-4" style={{ padding: 18, overflow: "auto", maxHeight: "70vh" }}>
          <label className="col gap-1">
            <span className="muted" style={{ fontSize: 11 }}>
              Name
            </span>
            <input
              className="input mono"
              autoFocus
              placeholder="e.g. paperhouse-ci"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          <div>
            <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
              Scopes
            </div>
            <div className="card" style={{ padding: 10 }}>
              {SCOPE_GROUPS.map((g) => (
                <div key={g} style={{ marginBottom: 8 }}>
                  <div
                    style={{
                      fontSize: 10,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      color: "var(--fg-3)",
                      marginBottom: 4,
                    }}
                  >
                    {g}
                  </div>
                  <div className="row gap-2" style={{ flexWrap: "wrap" }}>
                    {ALL_SCOPES.filter((s) => s.group === g).map((s) => {
                      const on = scopes.includes(s.id);
                      return (
                        <label
                          key={s.id}
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
                            onChange={() => toggle(s.id)}
                            style={{ margin: 0, accentColor: "var(--fg)" }}
                          />
                          <span className="mono">{s.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <label className="col gap-1">
            <span className="muted" style={{ fontSize: 11 }}>
              Expiry
            </span>
            <select className="input" value={expiry} onChange={(e) => setExpiry(e.target.value)}>
              <option value="7">7 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="365">1 year</option>
              <option value="never">never</option>
            </select>
            <span className="muted mono" style={{ fontSize: 11 }}>
              expires: {expiryDate}
            </span>
          </label>
        </div>

        <div className="row gap-2" style={{ padding: 14, borderTop: "1px solid var(--border)" }}>
          <span className="muted" style={{ fontSize: 11 }}>
            {scopes.length} scope{scopes.length === 1 ? "" : "s"} selected
          </span>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={() => onCreate(name.trim() || "untitled-token", scopes, expiryDate)}
            disabled={scopes.length === 0}
          >
            <I.plus width={11} height={11} /> Create
          </button>
        </div>
      </div>
    </div>
  );
}

function CreatedModal({ token, secret, onClose }: { token: Token; secret: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && confirmed) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, confirmed]);

  const copy = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) navigator.clipboard.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 210,
        background: "rgba(0,0,0,0.55)",
        display: "grid",
        placeItems: "center",
        backdropFilter: "blur(3px)",
      }}
    >
      <div className="os-modal" style={{ width: 620 }}>
        <div className="row gap-2 os-modal-h">
          <I.check width={14} height={14} style={{ color: "var(--ok, #4ade80)" }} />
          <span style={{ fontWeight: 600 }}>Token created — {token.name}</span>
        </div>
        <div className="col gap-3" style={{ padding: 18 }}>
          <div className="muted" style={{ fontSize: 12 }}>
            Copy this token now. We will <b style={{ color: "var(--fg)" }}>not</b> show it again.
          </div>
          <div
            className="card mono"
            style={{
              padding: "14px 16px",
              fontSize: 13,
              wordBreak: "break-all",
              background: "var(--bg-sunken)",
              position: "relative",
              lineHeight: 1.5,
            }}
          >
            {secret}
            <button
              className="btn sm primary"
              style={{ position: "absolute", top: 10, right: 10 }}
              onClick={copy}
            >
              <I.copy width={11} height={11} /> {copied ? "Copied" : "Copy token"}
            </button>
          </div>
          <label className="row gap-2" style={{ fontSize: 12, marginTop: 4, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              style={{ margin: 0, accentColor: "var(--fg)" }}
            />
            I have stored this token securely.
          </label>
        </div>
        <div className="row gap-2" style={{ padding: 14, borderTop: "1px solid var(--border)" }}>
          <div style={{ flex: 1 }} />
          <button className="btn primary" onClick={onClose} disabled={!confirmed}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
