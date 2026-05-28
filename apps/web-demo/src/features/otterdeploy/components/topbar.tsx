import { SvglLogo } from "../brand/svgl-logo";
import { I } from "../icons";
import { PROJECT } from "../data";

const labels: Record<string, string> = {
  overview: "Overview",
  graph: "Graph",
  deployments: "Deployments",
  logs: "Logs",
  metrics: "Metrics",
  env: "Variables",
  databases: "Databases",
  networking: "Networking",
  servers: "Servers",
  terminal: "Terminal",
  settings: "Settings",
  "new-service": "New service",
};

interface Props {
  tab: string;
  openCmd: () => void;
  openDeploy: () => void;
}

export function Topbar({ tab, openCmd, openDeploy }: Props) {
  const here = tab.startsWith("service:")
    ? tab.split(":")[1]
    : (labels[tab] ?? tab);
  return (
    <header className="os-topbar">
      <div className="os-brand">
        <div className="os-brand-mark">os</div>
        <span>otterdeploy</span>
      </div>
      <span
        style={{
          width: 1,
          height: 18,
          background: "var(--border)",
          margin: "0 6px",
        }}
      />
      <nav className="os-crumbs">
        <span>{PROJECT.team}</span>
        <span className="sep">/</span>
        <span>{PROJECT.name}</span>
        <span className="sep">/</span>
        <span className="here">{here}</span>
      </nav>

      <div className="os-spacer" />

      <button className="os-search" onClick={openCmd}>
        <I.search width={13} height={13} />
        <span style={{ flex: 1, textAlign: "left" }}>
          Search or run a command…
        </span>
        <span className="os-kbd">⌘</span>
        <span className="os-kbd">K</span>
      </button>

      <button className="btn">
        <SvglLogo
          search="GitHub"
          fallback="GitHub"
          size={14}
          background="transparent"
          border="0"
          color="currentColor"
          style={{ borderRadius: 0 }}
        />{" "}
        Connect
      </button>
      <button className="btn primary" onClick={openDeploy}>
        <I.plus width={13} height={13} /> New service
      </button>
    </header>
  );
}
