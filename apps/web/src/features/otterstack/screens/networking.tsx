// Networking (v3) — full Caddy editor.
// Ported from /tmp/anth-design-qP3sS7/otterstack/project/screens3.jsx (Networking3).

import { useEffect, useMemo, useState } from "react";

import { I } from "../icons";
import { PROJECTS, SERVICES, type ServiceKind } from "../data";
import { Field, SectionH, SettingRow, Switch3 } from "../components/form";
import {
  ALL_PROJECTS,
  ProjectFilterStrip,
  ProjectTagBadge,
  ProjectPicker,
  matchesProjectFilter,
} from "../components/project-filter";

type Tab = "routes" | "caddyfile" | "global" | "tls";

type Route = {
  id: string;
  name: string;
  kind: ServiceKind;
  port: number | null;
  internal: string;
  publicHosts: string[];
  rateLimit: number;
  encode: boolean;
  basicAuth: boolean;
  healthcheck: string;
  /** Owner project. Routes inherit from their owning service. */
  project?: string;
};

export function Networking() {
  const [tab, setTab] = useState<Tab>("routes");
  const initial = useMemo<Route[]>(
    () =>
      SERVICES.map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.kind,
        port: s.port,
        internal: `${s.name}.helio.internal`,
        publicHosts: s.domain ? [s.domain] : [],
        rateLimit: 100,
        encode: true,
        basicAuth: false,
        healthcheck: "/health",
        project: s.project,
      })),
    [],
  );
  const [routes, setRoutes] = useState<Route[]>(initial);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [reloadFlash, setReloadFlash] = useState(false);
  const [filter, setFilter] = useState<string>(ALL_PROJECTS);

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const p of PROJECTS) out[p.id] = routes.filter((r) => r.project === p.id).length;
    return out;
  }, [routes]);

  const filteredRoutes = useMemo(
    () => routes.filter((r) => matchesProjectFilter(filter, r.project ? [r.project] : [])),
    [routes, filter],
  );

  const togglePublic = (id: string) =>
    setRoutes((rs) =>
      rs.map((r) => {
        if (r.id !== id) return r;
        if (r.publicHosts.length > 0) return { ...r, publicHosts: [] };
        return { ...r, publicHosts: [`${r.name}.helio.so`] };
      }),
    );
  const updateRoute = (id: string, patch: Partial<Route>) =>
    setRoutes((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const reload = () => {
    setReloadFlash(true);
    setTimeout(() => setReloadFlash(false), 1200);
  };

  const caddyfile = useMemo(() => buildCaddyfileFull(routes), [routes]);

  const editing = routes.find((r) => r.id === editingId);

  const tabs: Array<[Tab, string, (typeof I)[keyof typeof I]]> = [
    ["routes", "Routes", I.graph],
    ["caddyfile", "Caddyfile", I.doc],
    ["global", "Global options", I.settings],
    ["tls", "TLS / certificates", I.lock],
  ];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* sub-nav */}
      <div className="row" style={{ borderBottom: "1px solid var(--border)", padding: "0 18px", height: 38 }}>
        {tabs.map(([id, lab, Ic]) => (
          <button key={id} className="os-envtab" data-active={tab === id} onClick={() => setTab(id)}>
            <Ic width={12} height={12} style={{ opacity: 0.7 }} /> <span>{lab}</span>
            <span className="os-envtab-underline" />
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <div className="row gap-2" style={{ alignItems: "center", height: "100%" }}>
          {reloadFlash && <span className="badge ok"><span className="dot" />reloaded · 73ms</span>}
          <button className="btn sm" onClick={reload}><I.refresh width={11} height={11} /> Reload Caddy</button>
        </div>
      </div>

      {tab === "routes" && (
        <RoutesPane
          routes={filteredRoutes}
          totalRoutes={routes.length}
          filter={filter}
          counts={counts}
          onFilter={setFilter}
          togglePublic={togglePublic}
          onEdit={(id) => setEditingId(id)}
        />
      )}
      {tab === "caddyfile" && <CaddyfilePane caddyfile={caddyfile} onReload={reload} />}
      {tab === "global" && <GlobalOptionsPane />}
      {tab === "tls" && <TLSPane />}

      {editing && (
        <RouteEditor
          route={editing}
          onClose={() => setEditingId(null)}
          onSave={(patch) => {
            updateRoute(editing.id, patch);
            setEditingId(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function RoutesPane({
  routes,
  totalRoutes,
  filter,
  counts,
  onFilter,
  togglePublic,
  onEdit,
}: {
  routes: Route[];
  totalRoutes: number;
  filter: string;
  counts: Record<string, number>;
  onFilter: (id: string) => void;
  togglePublic: (id: string) => void;
  onEdit: (id: string) => void;
}) {
  return (
    <div className="os-scroll" style={{ flex: 1, overflow: "auto", padding: 24 }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div className="row" style={{ marginBottom: 16 }}>
          <SectionH title="Routes" sub="Caddy edge proxy on :443 · routes auto-published via internal DNS" />
          <div style={{ flex: 1 }} />
          <button className="btn"><I.plus width={12} height={12} /> Custom route</button>
        </div>

        <div className="row" style={{ marginBottom: 14 }}>
          <ProjectFilterStrip active={filter} onChange={onFilter} counts={counts} />
          <div style={{ flex: 1 }} />
          <span className="muted mono" style={{ fontSize: 11 }}>
            {routes.length} / {totalRoutes} routes
          </span>
        </div>

        {/* topology */}
        <div className="card" style={{ padding: 16, marginBottom: 18 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 24px 1fr 24px 1fr",
              alignItems: "center",
              gap: 0,
            }}
          >
            <ProxyHop label="public internet" detail="0.0.0.0:443" Icon={I.globe} />
            <Arrow />
            <ProxyHop
              label="Caddy edge proxy"
              detail={`${routes.reduce((n, r) => n + r.publicHosts.length, 0)} domains · letsencrypt`}
              Icon={I.server}
              accent
            />
            <Arrow />
            <ProxyHop
              label="service mesh"
              detail={`${routes.length} services · *.helio.internal`}
              Icon={I.graph}
            />
          </div>
        </div>

        {/* routes table */}
        <div className="card" style={{ overflow: "hidden" }}>
          <div className="os-pe-head" style={{ padding: "10px 14px" }}>
            <span style={{ width: 150 }}>Service</span>
            <span style={{ flex: 1.4 }}>Internal address</span>
            <span style={{ flex: 1.4 }}>Public hostname</span>
            <span style={{ width: 90 }}>TLS</span>
            <span style={{ width: 60 }}>Public</span>
            <span style={{ width: 100, textAlign: "right" }}>Configure</span>
          </div>
          {routes.map((r, i) => (
            <RouteRow
              key={r.id}
              r={r}
              borderTop={i > 0}
              onTogglePublic={() => togglePublic(r.id)}
              onEdit={() => onEdit(r.id)}
            />
          ))}
        </div>

        <div className="muted" style={{ fontSize: 11, marginTop: 10 }}>
          Caddyfile is auto-generated from these rows. Switch to the{" "}
          <span className="mono" style={{ color: "var(--fg-2)" }}>Caddyfile</span> tab to edit it directly.
        </div>
      </div>
    </div>
  );
}

function RouteRow({
  r,
  borderTop,
  onTogglePublic,
  onEdit,
}: {
  r: Route;
  borderTop: boolean;
  onTogglePublic: () => void;
  onEdit: () => void;
}) {
  return (
    <div
      className="row"
      style={{
        padding: "10px 14px",
        borderTop: borderTop ? "1px solid var(--border)" : "none",
        fontSize: 12,
      }}
    >
      <span style={{ width: 150, display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
        <span className="row gap-2">
          {r.kind === "database" ? (
            <I.db width={13} height={13} style={{ color: "var(--fg-3)" }} />
          ) : (
            <I.service width={13} height={13} style={{ color: "var(--fg-3)" }} />
          )}
          <span className="mono" style={{ fontWeight: 500 }}>{r.name}</span>
        </span>
        {r.project && (
          <span className="row gap-1">
            <ProjectTagBadge id={r.project} />
          </span>
        )}
      </span>
      <span className="mono" style={{ flex: 1.4, color: "var(--fg-2)" }}>
        {r.internal}
        <span style={{ color: "var(--fg-4)" }}>:{r.port || 80}</span>
      </span>
      <span style={{ flex: 1.4, display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
        {r.publicHosts.length > 0 ? (
          r.publicHosts.map((host) => (
            <span
              key={host}
              className="mono"
              style={{
                color: "var(--fg)",
                background: "var(--bg-overlay)",
                padding: "2px 6px",
                borderRadius: 3,
                fontSize: 11,
              }}
            >
              https://{host}
            </span>
          ))
        ) : (
          <span className="muted" style={{ fontSize: 11 }}>— internal only —</span>
        )}
      </span>
      <span style={{ width: 90 }}>
        {r.publicHosts.length > 0 ? (
          <span className="badge"><span className="dot" style={{ background: "var(--ok)" }} />letsencrypt</span>
        ) : (
          <span className="muted">—</span>
        )}
      </span>
      <span style={{ width: 60 }}>
        <Switch3 on={r.publicHosts.length > 0} onChange={onTogglePublic} />
      </span>
      <span style={{ width: 100, textAlign: "right" }}>
        <button className="btn sm" onClick={onEdit}><I.edit width={10} height={10} /> Edit</button>
      </span>
    </div>
  );
}

function ProxyHop({
  label,
  detail,
  Icon,
  accent,
}: {
  label: string;
  detail: string;
  Icon: (typeof I)[keyof typeof I];
  accent?: boolean;
}) {
  return (
    <div
      style={{
        padding: 12,
        border: `1px solid ${accent ? "var(--fg)" : "var(--border)"}`,
        borderRadius: 8,
        background: accent ? "var(--bg-overlay)" : "transparent",
      }}
    >
      <div
        className="row gap-2"
        style={{
          fontSize: 10,
          color: "var(--fg-3)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginBottom: 4,
        }}
      >
        <Icon width={11} height={11} /> {label}
      </div>
      <div className="mono" style={{ fontSize: 12, color: "var(--fg)" }}>{detail}</div>
    </div>
  );
}

function Arrow() {
  return (
    <div style={{ display: "flex", justifyContent: "center", color: "var(--fg-4)" }}>
      <I.chev width={14} height={14} />
    </div>
  );
}

function CaddyfilePane({ caddyfile, onReload }: { caddyfile: string; onReload: () => void }) {
  const [text, setText] = useState(caddyfile);
  useEffect(() => setText(caddyfile), [caddyfile]);
  const dirty = text !== caddyfile;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div
        className="row gap-2"
        style={{ padding: "10px 18px", borderBottom: "1px solid var(--border)", background: "var(--bg-sunken)" }}
      >
        <span className="badge mono" style={{ background: "var(--bg-elev)" }}>/etc/caddy/Caddyfile</span>
        <span className="muted" style={{ fontSize: 11 }}>
          {text.split("\n").length} lines · {dirty ? "unsaved changes" : "in sync"}
        </span>
        <div style={{ flex: 1 }} />
        <button className="btn sm"><I.copy width={11} height={11} /> Copy</button>
        <button className="btn sm" onClick={() => setText(caddyfile)} disabled={!dirty}>Reset</button>
        <button className="btn sm primary" onClick={onReload} disabled={!dirty}>
          <I.refresh width={11} height={11} /> Save & reload
        </button>
      </div>

      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 280px", overflow: "hidden" }}>
        <div style={{ position: "relative", overflow: "hidden", background: "var(--bg)" }}>
          <div style={{ position: "absolute", inset: 0, display: "flex" }}>
            <div
              className="mono"
              style={{
                padding: "14px 8px 14px 12px",
                fontSize: 12,
                lineHeight: 1.7,
                color: "var(--fg-4)",
                background: "var(--bg-sunken)",
                borderRight: "1px solid var(--border)",
                userSelect: "none",
                textAlign: "right",
                minWidth: 38,
              }}
            >
              {text.split("\n").map((_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              className="mono"
              style={{
                flex: 1,
                padding: "14px",
                border: 0,
                outline: "none",
                resize: "none",
                background: "transparent",
                color: "var(--fg)",
                fontSize: 12,
                lineHeight: 1.7,
              }}
            />
          </div>
        </div>
        <div className="col gap-3" style={{ padding: 16, overflow: "auto", borderLeft: "1px solid var(--border)" }}>
          <div>
            <div
              className="muted"
              style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}
            >
              Validation
            </div>
            <div className="row gap-2" style={{ fontSize: 12 }}>
              <I.check width={12} height={12} style={{ color: "var(--ok)" }} />
              <span style={{ color: "var(--ok)" }}>Caddyfile syntax OK</span>
            </div>
            <div className="row gap-2" style={{ fontSize: 12, marginTop: 4 }}>
              <I.check width={12} height={12} style={{ color: "var(--ok)" }} />
              <span style={{ color: "var(--ok)" }}>All upstreams resolvable</span>
            </div>
          </div>
          <div style={{ height: 1, background: "var(--border)" }} />
          <div>
            <div
              className="muted"
              style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}
            >
              Snippets
            </div>
            <div className="col gap-1">
              {["rate_limit", "basicauth", "reverse_proxy", "@cors header", "log access"].map((s) => (
                <button key={s} className="btn ghost sm" style={{ justifyContent: "flex-start" }}>
                  <I.plus width={10} height={10} /> {s}
                </button>
              ))}
            </div>
          </div>
          <div style={{ height: 1, background: "var(--border)" }} />
          <div>
            <div
              className="muted"
              style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}
            >
              Reload safety
            </div>
            <div className="muted" style={{ fontSize: 11, lineHeight: 1.5 }}>
              Otterstack validates with{" "}
              <span className="mono" style={{ color: "var(--fg-2)" }}>caddy validate</span> before applying. Failed
              reloads keep the previous config running with zero downtime.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function GlobalOptionsPane() {
  return (
    <div className="os-scroll" style={{ flex: 1, overflow: "auto", padding: 24 }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <SectionH title="Global options" sub="Apply to every site served by the proxy" />
        <div className="card" style={{ padding: 18, marginTop: 12 }}>
          <Field label="Admin email (Let's Encrypt account)">
            <input className="input mono" defaultValue="ops@helio.so" />
          </Field>
          <div style={{ height: 12 }} />
          <Field label="Admin endpoint">
            <input className="input mono" defaultValue="localhost:2019" />
          </Field>
          <div style={{ height: 12 }} />
          <SettingRow label="HTTP/3" sub="Serve QUIC on the public listener" defaultOn />
          <SettingRow label="Strict SNI" sub="Reject requests without matching SNI" defaultOn />
          <SettingRow label="Compression (zstd, gzip)" sub="Encode responses on the wire" defaultOn />
          <SettingRow label="Auto-HTTPS redirect" sub="80 → 443 for all sites" defaultOn />
        </div>

        <div style={{ height: 18 }} />
        <SectionH title="Logging" sub="Centralised access + error logs" />
        <div className="card" style={{ padding: 18, marginTop: 12 }}>
          <Field label="Sink">
            <select className="input">
              <option>otterstack-logs.helio.internal:5170</option>
              <option>stdout</option>
              <option>file (/var/log/caddy/access.log)</option>
            </select>
          </Field>
          <div style={{ height: 12 }} />
          <Field label="Format">
            <select className="input">
              <option>json</option>
              <option>console</option>
            </select>
          </Field>
        </div>
      </div>
    </div>
  );
}

function TLSPane() {
  return (
    <div className="os-scroll" style={{ flex: 1, overflow: "auto", padding: 24 }}>
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        <SectionH title="TLS certificates" sub="Issued via ACME · auto-renewed before expiry" />
        <div className="card" style={{ overflow: "hidden", marginTop: 12 }}>
          <div className="os-pe-head" style={{ padding: "10px 14px" }}>
            <span style={{ flex: 2 }}>Hostname</span>
            <span style={{ width: 110 }}>Issuer</span>
            <span style={{ width: 130 }}>Issued</span>
            <span style={{ width: 130 }}>Renews</span>
            <span style={{ width: 100, textAlign: "right" }}>Status</span>
          </div>
          {["helio.so", "app.helio.so", "api.helio.so"].map((h, i) => (
            <div
              key={h}
              className="row"
              style={{
                padding: "10px 14px",
                borderTop: i > 0 ? "1px solid var(--border)" : "none",
                fontSize: 12,
              }}
            >
              <span style={{ flex: 2, display: "flex", alignItems: "center", gap: 8 }}>
                <I.lock width={12} height={12} style={{ color: "var(--fg-3)" }} />
                <span className="mono">{h}</span>
              </span>
              <span style={{ width: 110, color: "var(--fg-2)" }}>Let's Encrypt</span>
              <span style={{ width: 130, color: "var(--fg-2)" }} className="mono">2026-04-{20 - i}</span>
              <span style={{ width: 130, color: "var(--fg-2)" }} className="mono">2026-06-{20 - i}</span>
              <span style={{ width: 100, textAlign: "right" }}>
                <span className="badge ok"><span className="dot" />active</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RouteEditor({
  route,
  onClose,
  onSave,
}: {
  route: Route;
  onClose: () => void;
  onSave: (patch: Route) => void;
}) {
  const [r, setR] = useState<Route>({ ...route });
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
      <div onClick={(e) => e.stopPropagation()} className="os-modal" style={{ width: 640 }}>
        <div className="row gap-2 os-modal-h">
          <I.edit width={14} height={14} />
          <span style={{ fontWeight: 600 }}>
            Edit route · <span className="mono">{r.name}</span>
          </span>
          <div style={{ flex: 1 }} />
          <button className="btn ghost icon sm" onClick={onClose}><I.close width={13} height={13} /></button>
        </div>
        <div className="col gap-3" style={{ padding: 18, overflow: "auto", maxHeight: "60vh" }}>
          <Field label="Public hostnames">
            <div className="col gap-2">
              <div className="muted" style={{ fontSize: 11, marginTop: -4 }}>
                One certificate is issued per host. All hosts share this route&apos;s config.
              </div>
              {r.publicHosts.length === 0 && (
                <div className="muted" style={{ fontSize: 11 }}>
                  No public hostnames yet — service is internal only. Add one below.
                </div>
              )}
              {r.publicHosts.map((host, i) => (
                <div key={i} className="row gap-2">
                  <input
                    className="input mono"
                    value={host}
                    placeholder={`${r.name}.helio.so`}
                    onChange={(e) =>
                      setR({
                        ...r,
                        publicHosts: r.publicHosts.map((h, j) => (j === i ? e.target.value : h)),
                      })
                    }
                  />
                  <button
                    type="button"
                    className="btn ghost icon sm"
                    title="Remove this hostname"
                    onClick={() =>
                      setR({ ...r, publicHosts: r.publicHosts.filter((_, j) => j !== i) })
                    }
                  >
                    <I.trash width={12} height={12} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn sm"
                style={{ alignSelf: "flex-start" }}
                onClick={() =>
                  setR({
                    ...r,
                    publicHosts: [
                      ...r.publicHosts,
                      r.publicHosts.length === 0 ? `${r.name}.helio.so` : "",
                    ],
                  })
                }
              >
                <I.plus width={11} height={11} /> Add domain
              </button>
            </div>
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Upstream">
              <input
                className="input mono"
                value={`${r.internal}:${r.port || 80}`}
                readOnly
                style={{ color: "var(--fg-3)" }}
              />
            </Field>
            <Field label="Health check path">
              <input
                className="input mono"
                value={r.healthcheck}
                onChange={(e) => setR({ ...r, healthcheck: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Rate limit (req/sec)">
            <input
              className="input mono"
              type="number"
              value={r.rateLimit}
              onChange={(e) => setR({ ...r, rateLimit: +e.target.value })}
            />
          </Field>

          <Field label="Owner project">
            <ProjectPicker
              value={r.project}
              onChange={(project) => setR({ ...r, project })}
              allowNone
              noneLabel="Cluster-wide route (no owner project)"
            />
          </Field>
          <SettingRow label="Compression (zstd, gzip)" sub="Encode responses to clients" defaultOn={r.encode} />
          <SettingRow label="Basic auth" sub="Require username/password" defaultOn={r.basicAuth} />
          <SettingRow label="Forward client IP (X-Forwarded-For)" sub="Pass real IP to upstream" defaultOn />
          <SettingRow
            label="WebSocket upgrade"
            sub="Allow connection upgrade for ws:// traffic"
            defaultOn
          />
        </div>
        <div className="row gap-2" style={{ padding: 14, borderTop: "1px solid var(--border)" }}>
          <span className="muted" style={{ fontSize: 11 }}>
            Saving will trigger a Caddy reload (zero-downtime)
          </span>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={() => onSave(r)}>Save & reload</button>
        </div>
      </div>
    </div>
  );
}

function buildCaddyfileFull(routes: Route[]): string {
  const L: string[] = [];
  L.push("# Auto-generated by Otterstack — edit here OR via the Routes table");
  L.push("# Last sync: now");
  L.push("");
  L.push("{");
  L.push("\temail ops@helio.so");
  L.push("\tadmin localhost:2019");
  L.push("\tservers {");
  L.push("\t\tprotocols h1 h2 h3");
  L.push("\t}");
  L.push("}");
  L.push("");
  for (const r of routes.filter((x) => x.publicHosts.length > 0)) {
    const hostList = r.publicHosts.filter((h) => h.trim().length > 0).join(", ");
    if (!hostList) continue;
    L.push(`${hostList} {`);
    L.push("\ttls {");
    L.push("\t\tissuer acme");
    L.push("\t}");
    L.push("\tencode zstd gzip");
    L.push(`\trate_limit ${r.rateLimit}r/s`);
    L.push(`\treverse_proxy ${r.internal}:${r.port || 80} {`);
    L.push("\t\theader_up X-Forwarded-For {remote_host}");
    L.push("\t\theader_up X-Real-IP {remote_host}");
    L.push(`\t\thealth_uri ${r.healthcheck}`);
    L.push("\t\thealth_interval 10s");
    L.push("\t}");
    L.push("\tlog {");
    L.push("\t\toutput net otterstack-logs.helio.internal:5170");
    L.push("\t\tformat json");
    L.push("\t}");
    L.push("}");
    L.push("");
  }
  return L.join("\n").trim();
}
