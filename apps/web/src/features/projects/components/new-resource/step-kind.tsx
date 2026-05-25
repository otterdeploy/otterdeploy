// Step_Kind — engine-picker step, ported verbatim from
// apps/web-demo/src/features/otterstack/screens/new-service.tsx.
// Pass A: uses local useState for kindId. Pass B will lift state to tanstack-form.
import type { CSSProperties, ReactNode } from "react";

import { useEffect, useState } from "react";

import {
  SERVICE_KINDS,
  TEMPLATES,
  type ServiceKind,
  type Template,
} from "@/features/projects/data/service-kinds";
import { DatabaseLogo } from "@/shared/components/brand/database-logo";

import { SectionH } from "./form-primitives";
import { I, type IconKey } from "./icons";

export type KindTab = "compute" | "data" | "template" | "custom";

const iconKey = (raw: string): IconKey => ((raw as IconKey) in I ? (raw as IconKey) : "doc");

function renderLauncherKindIcon(
  item: ServiceKind | Template,
  tab: KindTab,
  Icon: (props: { width?: number; height?: number; style?: CSSProperties }) => ReactNode,
) {
  if (tab !== "data") return <Icon width={14} height={14} />;

  const id = item.id.toLowerCase();
  const supportsBrandLogo =
    id === "postgres" ||
    id === "mysql" ||
    id === "mariadb" ||
    id === "redis" ||
    id === "mongodb" ||
    id === "clickhouse";

  if (supportsBrandLogo) {
    return (
      <DatabaseLogo value={`${item.id} ${item.name}`} size={14} color="var(--muted-foreground)" />
    );
  }

  return <Icon width={14} height={14} />;
}

export function StepKind({
  kindId,
  setKindId,
  initialTab,
}: {
  kindId: string | null;
  setKindId: (id: string) => void;
  initialTab?: KindTab;
}) {
  const [tab, setTab] = useState<KindTab>(initialTab ?? "compute");

  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  const groups: Record<KindTab, { label: string; sub: string }> = {
    compute: {
      label: "Compute",
      sub: "Code that runs your business logic — apps, workers, jobs, static sites",
    },
    data: {
      label: "Data",
      sub: "Stateful services — databases, caches, queues, search, storage",
    },
    template: { label: "Templates", sub: "Curated multi-service starters" },
    custom: { label: "Custom", sub: "Bring your own image or compose file" },
  };

  const tabs: Array<[KindTab, IconKey]> = [
    ["compute", "service"],
    ["data", "db"],
    ["template", "folder"],
    ["custom", "bolt"],
  ];

  const items: Array<ServiceKind | Template> =
    tab === "template" ? TEMPLATES : SERVICE_KINDS.filter((k) => k.group === tab);

  return (
    <>
      <SectionH
        title="What do you want to deploy?"
        sub="Pick a service type to get a tailored creation flow"
      />

      <div
        className="flex items-center"
        style={{
          borderBottom: "1px solid var(--border)",
          marginTop: 10,
          gap: 0,
        }}
      >
        {tabs.map(([id, ic]) => {
          const Ic = I[ic];
          return (
            <button
              key={id}
              className="os-envtab"
              data-active={tab === id}
              onClick={() => setTab(id)}
              style={{ height: 36, borderRight: 0 }}
            >
              <Ic width={12} height={12} style={{ opacity: 0.7 }} /> <span>{groups[id].label}</span>
              <span className="os-envtab-underline" />
            </button>
          );
        })}
      </div>

      <div className="text-muted-foreground" style={{ fontSize: 12, marginTop: 10 }}>
        {groups[tab].sub}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 10,
          marginTop: 14,
        }}
      >
        {items.map((it) => {
          const Ic = I[iconKey(it.icon)];
          const active = kindId === it.id;
          const popular = "popular" in it ? !!it.popular : false;
          const examples = "examples" in it ? it.examples : undefined;
          const versions = "versions" in it ? it.versions : undefined;
          const services = "services" in it ? it.services : undefined;
          return (
            <button
              key={it.id}
              onClick={() => setKindId(it.id)}
              className={`os-builder ${active ? "active" : ""}`}
              style={{ textAlign: "left", padding: 14, minHeight: 96 }}
            >
              {popular && <span className="os-builder-pop">popular</span>}
              <div className="flex items-center gap-2">
                <div className="os-builder-icon">{renderLauncherKindIcon(it, tab, Ic)}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{it.name}</div>
                </div>
                {active && (
                  <I.check width={12} height={12} style={{ color: "var(--foreground)" }} />
                )}
              </div>
              <div
                className="text-muted-foreground"
                style={{ fontSize: 11, marginTop: 6, lineHeight: 1.45 }}
              >
                {it.sub}
              </div>
              {examples && (
                <div
                  className="font-mono"
                  style={{ fontSize: 10, color: "var(--muted-foreground)", marginTop: 6 }}
                >
                  {examples}
                </div>
              )}
              {versions && (
                <div
                  className="font-mono"
                  style={{ fontSize: 10, color: "var(--muted-foreground)", marginTop: 6 }}
                >
                  versions: {versions.slice(0, 3).join(", ")}
                </div>
              )}
              {services !== undefined && (
                <div
                  className="font-mono"
                  style={{ fontSize: 10, color: "var(--muted-foreground)", marginTop: 6 }}
                >
                  {services} services included
                </div>
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}
