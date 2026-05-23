import { DatabaseLogo } from "../brand/database-logo";
import { I } from "../icons";
import { PROJECT, SERVICES, DEPLOYMENTS, type Env } from "../data";
import { EnvSwitcher } from "./env-switcher";
import { UserMenu } from "./user-menu";
import type { Tab } from "../app";

const projectItems: Array<{
  id: Tab;
  label: string;
  icon: keyof typeof I;
  count?: number;
}> = [
  { id: "overview", label: "Overview", icon: "home" },
  { id: "graph", label: "Graph", icon: "graph" },
  {
    id: "deployments",
    label: "Deployments",
    icon: "rocket",
    count: DEPLOYMENTS.length,
  },
  { id: "logs", label: "Logs", icon: "log" },
  { id: "metrics", label: "Metrics", icon: "metrics" },
  { id: "env", label: "Variables", icon: "env" },
  { id: "networking", label: "Networking", icon: "globe" },
  { id: "servers", label: "Servers", icon: "server", count: 3 },
  { id: "terminal", label: "Terminal", icon: "bolt" },
  { id: "settings", label: "Settings", icon: "settings" },
];

const infraItems: Array<{ id: Tab; label: string; icon: keyof typeof I }> = [
  { id: "templates", label: "Templates", icon: "folder" },
  { id: "backups", label: "Backups", icon: "download" },
  { id: "volumes", label: "Volumes", icon: "scale" },
  { id: "edge-logs", label: "Edge logs", icon: "globe" },
  { id: "audit", label: "Audit", icon: "doc" },
  { id: "docker-raw", label: "Docker", icon: "service" },
];

const adminItems: Array<{ id: Tab; label: string; icon: keyof typeof I }> = [
  { id: "git-providers", label: "Git providers", icon: "branch" },
  { id: "registries", label: "Registries", icon: "service" },
  { id: "ssh-keys", label: "SSH keys", icon: "key" },
  { id: "notifications", label: "Notifications", icon: "warning" },
  { id: "certificates", label: "Certificates", icon: "lock" },
  { id: "api-tokens", label: "API tokens", icon: "key" },
  { id: "webhooks", label: "Webhooks", icon: "link" },
  { id: "cluster-settings", label: "Cluster", icon: "settings" },
];

type Props = {
  tab: Tab | string;
  setTab: (t: Tab | string) => void;
  env: Env;
  setEnv: (e: Env) => void;
};

export function Sidebar({ tab, setTab, env, setEnv }: Props) {
  return (
    <aside className="os-sidebar" style={{ overflow: "hidden" }}>
      <div
        className="os-side-section"
        style={{ paddingTop: 12, flexShrink: 0 }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "0 4px",
          }}
        >
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: 5,
              background: "var(--bg-overlay)",
              display: "grid",
              placeItems: "center",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            h
          </div>
          <div
            style={{ display: "flex", flexDirection: "column", minWidth: 0 }}
          >
            <div style={{ fontWeight: 500, fontSize: 13 }}>{PROJECT.name}</div>
            <div className="muted" style={{ fontSize: 11 }}>
              {PROJECT.team}
            </div>
          </div>
          <button
            className="btn ghost icon sm"
            style={{ marginLeft: "auto" }}
            title="Switch project"
          >
            <I.chevDown width={12} height={12} />
          </button>
        </div>
      </div>

      <div className="os-side-section" style={{ flexShrink: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "0 4px",
          }}
        >
          <EnvSwitcher env={env} setEnv={setEnv} />
        </div>
      </div>

      <div
        className="os-scroll"
        style={{
          flex: 1,
          overflowY: "auto",
          overflowX: "hidden",
          minHeight: 0,
        }}
      >
        <NavGroup
          label="Project"
          items={projectItems}
          tab={tab}
          setTab={setTab}
        />

        <div className="os-side-section">
          <div
            className="os-side-label"
            style={{ display: "flex", alignItems: "center" }}
          >
            <span>Services</span>
            <button
              className="btn ghost icon sm"
              style={{ marginLeft: "auto", height: 18, width: 18 }}
              onClick={() => setTab("new-service")}
              title="New service"
            >
              <I.plus width={10} height={10} />
            </button>
          </div>
          <div className="os-nav">
            {SERVICES.map((s) => (
              <button
                key={s.id}
                className={`os-nav-item ${tab === `service:${s.id}` ? "active" : ""}`}
                onClick={() => setTab(`service:${s.id}`)}
              >
                {s.kind === "database" ? (
                  <DatabaseLogo value={`${s.name} ${s.image}`} size={14} />
                ) : (
                  <I.service className="icon" width={14} height={14} />
                )}
                <span className="mono" style={{ fontSize: 12 }}>
                  {s.name}
                </span>
                <span className="count">
                  <span
                    style={{
                      display: "inline-block",
                      width: 5,
                      height: 5,
                      borderRadius: "50%",
                      background:
                        s.status === "healthy"
                          ? "var(--ok)"
                          : s.status === "degraded"
                            ? "var(--warn)"
                            : "var(--err)",
                      marginRight: 4,
                    }}
                  />
                </span>
              </button>
            ))}
          </div>
        </div>

        <NavGroup
          label="Infrastructure"
          items={infraItems}
          tab={tab}
          setTab={setTab}
        />
        <NavGroup
          label="Cluster admin"
          items={adminItems}
          tab={tab}
          setTab={setTab}
        />
      </div>

      <div
        className="os-side-section"
        style={{ paddingBottom: 8, paddingTop: 6, flexShrink: 0 }}
      >
        <div
          style={{
            padding: "0 4px 6px",
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 10,
            color: "var(--fg-4)",
          }}
        >
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: "var(--ok)",
            }}
          />
          <span>self-hosted · {PROJECT.region}</span>
          <span className="mono" style={{ marginLeft: "auto" }}>
            v1.4.2-rc.1
          </span>
        </div>
        <UserMenu onSettings={() => setTab("settings")} />
      </div>
    </aside>
  );
}

function NavGroup({
  label,
  items,
  tab,
  setTab,
}: {
  label?: string;
  items: Array<{
    id: Tab;
    label: string;
    icon: keyof typeof I;
    count?: number;
  }>;
  tab: Tab | string;
  setTab: (t: Tab | string) => void;
}) {
  return (
    <div className="os-side-section">
      {label && <div className="os-side-label">{label}</div>}
      <div className="os-nav">
        {items.map((it) => {
          const Icon = I[it.icon];
          return (
            <button
              key={it.id}
              className={`os-nav-item ${tab === it.id ? "active" : ""}`}
              onClick={() => setTab(it.id)}
            >
              <Icon className="icon" width={14} height={14} />
              <span>{it.label}</span>
              {it.count != null ? (
                <span className="count">{it.count}</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
