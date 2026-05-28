// KindPicker — presentational component for selecting service kinds.
// Extracted from StepKind to allow shared use in form-context-bound steps and dialogs.
import type { CSSProperties, ReactNode } from "react";

import { useEffect, useState } from "react";

import {
  SERVICE_KINDS,
  TEMPLATES,
  type ServiceKind,
  type Template,
} from "@/features/projects/data/service-kinds";
import { DatabaseLogo } from "@/shared/components/brand/database-logo";
import { cn } from "@/shared/lib/utils";

import {
  builderCardClass,
  builderCardActiveClass,
  builderIconClass,
  builderPopClass,
} from "./form-primitives";
import { I, type IconKey } from "./icons";

export type KindTab = "compute" | "data" | "template" | "custom";

const iconKey = (raw: string): IconKey => ((raw as IconKey) in I ? (raw as IconKey) : "doc");

export function renderLauncherKindIcon(
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

interface KindPickerProps {
  value: string | null;
  onChange: (id: string) => void;
  initialTab?: KindTab;
}

export function KindPicker({ value, onChange, initialTab }: KindPickerProps) {
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
      <div className="flex items-center border-b">
        {tabs.map(([id, ic]) => {
          const Ic = I[ic];
          const isActive = tab === id;
          return (
            <button
              key={id}
              type="button"
              data-active={isActive}
              onClick={() => setTab(id)}
              className={cn(
                "group/tab relative inline-flex h-9 cursor-pointer items-center gap-1.5 border-0 bg-transparent px-3.5 text-xs text-muted-foreground hover:text-foreground",
                isActive && "font-medium text-foreground",
              )}
            >
              <Ic width={12} height={12} className="opacity-70" />
              <span>{groups[id].label}</span>
              <span className="absolute inset-x-0 -bottom-px h-0.5 bg-foreground opacity-0 group-data-[active=true]/tab:opacity-100" />
            </button>
          );
        })}
      </div>

      <div className="mt-2.5 text-xs text-muted-foreground">{groups[tab].sub}</div>

      <div className="mt-3.5 grid grid-cols-3 gap-2.5">
        {items.map((it) => {
          const Ic = I[iconKey(it.icon)];
          const active = value === it.id;
          const popular = "popular" in it ? !!it.popular : false;
          const examples = "examples" in it ? it.examples : undefined;
          const versions = "versions" in it ? it.versions : undefined;
          const services = "services" in it ? it.services : undefined;
          return (
            <button
              key={it.id}
              type="button"
              onClick={() => onChange(it.id)}
              className={cn(
                builderCardClass,
                "min-h-24",
                active && builderCardActiveClass,
              )}
            >
              {popular && <span className={builderPopClass}>popular</span>}
              <div className="flex items-center gap-2">
                <div className={builderIconClass}>{renderLauncherKindIcon(it, tab, Ic)}</div>
                <div className="flex-1 text-[13px] font-semibold">{it.name}</div>
                {active && (
                  <I.check width={12} height={12} className="text-foreground" />
                )}
              </div>
              <div className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
                {it.sub}
              </div>
              {examples && (
                <div className="mt-1.5 font-mono text-[10px] text-muted-foreground">
                  {examples}
                </div>
              )}
              {versions && (
                <div className="mt-1.5 font-mono text-[10px] text-muted-foreground">
                  versions: {versions.slice(0, 3).join(", ")}
                </div>
              )}
              {services !== undefined && (
                <div className="mt-1.5 font-mono text-[10px] text-muted-foreground">
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
