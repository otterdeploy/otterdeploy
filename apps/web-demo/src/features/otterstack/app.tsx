import { useCallback, useEffect, useState } from "react";

import { Sidebar } from "./components/sidebar";
import { Topbar } from "./components/topbar";
import { Toaster, type Toast } from "./components/toaster";
import { CommandPalette } from "./components/command-palette";
import { DeployModal } from "./components/deploy-modal";

import { Overview } from "./screens/overview";
import { Deployments } from "./screens/deployments";
import { Logs } from "./screens/logs";
import { EnvVars } from "./screens/env";
import { Databases } from "./screens/databases";
import { Networking } from "./screens/networking";
import { Metrics } from "./screens/metrics";
import { Settings } from "./screens/settings";
import { ServiceDetail } from "./screens/service-detail";
import { NewService } from "./screens/new-service";
import { ProjectWorkspace } from "./screens/project-workspace";
import { Servers } from "./screens/servers";
import { TerminalWorkspace } from "./components/terminal-workspace";

// Infrastructure (operational)
import { Templates } from "./screens/templates";
import { Backups } from "./screens/backups";
import { Volumes } from "./screens/volumes";
import { EdgeLogs } from "./screens/edge-logs";
import { Audit } from "./screens/audit";
import { DockerRaw } from "./screens/docker-raw";

// Cluster admin (configuration)
import { GitProviders } from "./screens/git-providers";
import { Registries } from "./screens/registries";
import { SshKeys } from "./screens/ssh-keys";
import { Notifications } from "./screens/notifications";
import { Certificates } from "./screens/certificates";
import { ApiTokens } from "./screens/api-tokens";
import { Webhooks } from "./screens/webhooks";
import { ClusterSettings } from "./screens/cluster-settings";

import { DEPLOYMENTS, type Deployment, type Env } from "./data";
import { rid } from "./data";

export type Tab =
  | "overview"
  | "graph"
  | "deployments"
  | "logs"
  | "metrics"
  | "env"
  | "databases"
  | "networking"
  | "servers"
  | "terminal"
  | "settings"
  | "new-service"
  | "service"
  | `service:${string}`
  // Infrastructure (operational)
  | "templates"
  | "backups"
  | "volumes"
  | "edge-logs"
  | "audit"
  | "docker-raw"
  // Cluster admin (configuration)
  | "git-providers"
  | "registries"
  | "ssh-keys"
  | "notifications"
  | "certificates"
  | "api-tokens"
  | "webhooks"
  | "cluster-settings";

type Props = Record<string, never>;

interface NewServiceLaunch {
  kindId?: string | null;
  kindTab?: "compute" | "data" | "template" | "custom";
  step?: "kind" | "source" | "builder" | "image" | "compose" | "version" | "networking" | "resources" | "storage" | "variables" | "advanced" | "review";
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function OtterstackApp(_: Props) {
  const [tab, setTabRaw] = useState<Tab | string>("overview");
  const [env, setEnv] = useState<Env>("production");
  const [cmdOpen, setCmdOpen] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);
  const [deployments, setDeployments] = useState<Deployment[]>(DEPLOYMENTS);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [logTarget, setLogTarget] = useState<string | null>(null);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [newServiceLaunch, setNewServiceLaunch] = useState<NewServiceLaunch | undefined>(undefined);

  const setTab = useCallback((t: Tab | string) => {
    if (typeof t === "string" && t.startsWith("service:")) {
      setServiceId(t.split(":")[1] ?? null);
      setTabRaw("service");
    } else {
      if (t === "new-service") setNewServiceLaunch(undefined);
      setTabRaw(t);
    }
  }, []);

  // ⌘K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCmdOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pushToast = useCallback((msg: string, kind: Toast["kind"] = "ok") => {
    const id = Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const openNewService = useCallback((launch?: NewServiceLaunch) => {
    setNewServiceLaunch(launch);
    setTabRaw("new-service");
  }, []);

  const handleCmd = useCallback(
    (id: string) => {
      if (id === "deploy") {
        setDeployOpen(true);
      } else if (id === "rollback") {
        setDeployments((ds) => {
          const next = [...ds];
          const idx = next.findIndex((d) => d.status === "live");
          if (idx >= 0) next[idx] = { ...next[idx], status: "rolled-back" };
          return next;
        });
        pushToast("Rolled back to previous deployment", "ok");
      } else if (id.startsWith("logs:")) {
        setTab("logs");
        setLogTarget(id.split(":")[1] ?? null);
      } else if (id.startsWith("service:")) {
        setServiceId(id.split(":")[1] ?? null);
        setTab("service");
      } else if (id === "new-service") {
        openNewService();
      } else if (id.startsWith("goto:")) {
        const part = id.split(":")[1];
        if (part) setTab(part);
      } else if (id.startsWith("env:")) {
        const m: Record<string, Env> = { "env:prod": "production", "env:staging": "staging", "env:preview": "preview" };
        const next = m[id];
        if (next) {
          setEnv(next);
          pushToast(`Switched to ${next}`, "info");
        }
      }
    },
    [openNewService, pushToast, setTab],
  );

  const onRollback = (d: Deployment) => {
    setDeployments((ds) => ds.map((x) => (x.id === d.id ? { ...x, status: "rolled-back" } : x)));
    pushToast(`Rolled back ${d.service} → ${d.commit}`, "ok");
  };

  const onDeploy = () => setDeployOpen(true);

  const afterDeploy = (name: string) => {
    pushToast(`Deployed ${name} successfully`, "ok");
    setDeployments((ds) => [
      {
        id: "d_" + Math.random().toString(36).slice(2, 9),
        service: name,
        status: "live",
        commit: rid(),
        msg: "initial deploy",
        author: "you",
        when: "just now",
        dur: "1m 24s",
        env,
      },
      ...ds,
    ]);
  };

  const openService = (id: string) => {
    setServiceId(id);
    setTab("service");
  };

  let hero: React.ReactNode = null;
  if (tab === "service" && serviceId) {
    hero = (
      <ServiceDetail
        serviceId={serviceId}
        env={env}
        onTab={setTab}
        onOpenLogs={(id) => {
          setTab("logs");
          setLogTarget(id);
        }}
      />
    );
  } else if (tab === "new-service") {
    hero = <NewService onTab={setTab} initialSelection={newServiceLaunch} />;
  } else if (tab === "graph") {
    hero = (
      <ProjectWorkspace
        env={env}
        onOpenLogs={(id) => {
          setTab("logs");
          setLogTarget(id);
        }}
        onDeploy={onDeploy}
        onOpenService={openService}
        onNewService={() => openNewService()}
      />
    );
  } else if (tab === "overview") hero = <Overview env={env} />;
  else if (tab === "deployments") hero = <Deployments deployments={deployments} onRollback={onRollback} />;
  else if (tab === "logs") hero = <Logs target={logTarget} />;
  else if (tab === "env") hero = <EnvVars />;
  else if (tab === "databases") hero = <Databases />;
  else if (tab === "networking") hero = <Networking />;
  else if (tab === "servers") hero = <Servers />;
  else if (tab === "terminal") hero = <TerminalWorkspace />;
  else if (tab === "metrics") hero = <Metrics />;
  else if (tab === "settings") hero = <Settings />;
  else if (tab === "templates") hero = <Templates />;
  else if (tab === "backups") hero = <Backups />;
  else if (tab === "volumes") hero = <Volumes />;
  else if (tab === "edge-logs") hero = <EdgeLogs />;
  else if (tab === "audit") hero = <Audit />;
  else if (tab === "docker-raw") hero = <DockerRaw />;
  else if (tab === "git-providers") hero = <GitProviders />;
  else if (tab === "registries") hero = <Registries />;
  else if (tab === "ssh-keys") hero = <SshKeys />;
  else if (tab === "notifications") hero = <Notifications />;
  else if (tab === "certificates") hero = <Certificates />;
  else if (tab === "api-tokens") hero = <ApiTokens />;
  else if (tab === "webhooks") hero = <Webhooks />;
  else if (tab === "cluster-settings") hero = <ClusterSettings />;

  return (
    <div className="os-app">
      <Topbar
        tab={typeof tab === "string" ? tab : "overview"}
        openCmd={() => setCmdOpen(true)}
        openDeploy={onDeploy}
      />
      <Sidebar tab={tab} setTab={setTab} env={env} setEnv={setEnv} />
      <main className="os-main">
        {hero}
        <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} onAction={handleCmd} />
        <DeployModal
          open={deployOpen}
          onClose={() => setDeployOpen(false)}
          onDeploy={afterDeploy}
          onOpenNewService={openNewService}
        />
        <Toaster toasts={toasts} dismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
      </main>
    </div>
  );
}
