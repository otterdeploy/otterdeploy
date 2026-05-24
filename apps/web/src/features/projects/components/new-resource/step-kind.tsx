// Step_Kind — engine-picker step, ported verbatim from
// apps/web-demo/src/features/otterstack/screens/new-service.tsx.
// Change 4: Tailwind conversion.
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";

import { DatabaseLogo } from "@/shared/components/brand/database-logo";
import { I, type IconKey } from "./icons";
import { SERVICE_KINDS, TEMPLATES, type ServiceKindDef, type Template } from "@/features/projects/data/service-kinds";
import { SectionH } from "./form-primitives";
import { cn } from "@/shared/lib/utils";

export type KindTab = "compute" | "data" | "template" | "custom";

const iconKey = (raw: string): IconKey =>
  (raw as IconKey) in I ? (raw as IconKey) : "doc";

function renderLauncherKindIcon(
  item: ServiceKindDef | Template,
  tab: KindTab,
  Icon: (props: {
    width?: number;
    height?: number;
    style?: CSSProperties;
  }) => ReactNode,
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
      <DatabaseLogo
        value={`${item.id} ${item.name}`}
        size={14}
        color="var(--muted-foreground)"
      />
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

  const items: Array<ServiceKindDef | Template> =
    tab === "template"
      ? TEMPLATES
      : SERVICE_KINDS.filter((k) => k.group === tab);

  return (
    <>
      <SectionH
        title="What do you want to deploy?"
        sub="Pick a service type to get a tailored creation flow"
      />

      <div className="flex items-center border-b border-border mt-[10px]">
        {tabs.map(([id, ic]) => {
          const Ic = I[ic];
          return (
            <button
              key={id}
              className={cn(
                "relative inline-flex items-center gap-1.5 px-[14px] h-[38px] text-xs text-muted-foreground bg-transparent border-0 border-r border-border cursor-pointer font-[inherit] hover:text-foreground",
                tab === id && "text-foreground font-medium",
              )}
              data-active={tab === id}
              onClick={() => setTab(id)}
            >
              <Ic width={12} height={12} style={{ opacity: 0.7 }} />{" "}
              <span>{groups[id].label}</span>
              {tab === id && (
                <span className="absolute left-0 right-0 bottom-[-1px] h-0.5 bg-foreground" />
              )}
            </button>
          );
        })}
      </div>

      <div className="text-muted-foreground text-xs mt-[10px]">
        {groups[tab].sub}
      </div>

      <div className="grid grid-cols-3 gap-[10px] mt-[14px]">
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
              className={cn(
                "relative p-[14px] bg-card border border-border rounded-lg cursor-pointer text-left font-[inherit] text-foreground hover:border-ring min-h-[96px]",
                active && "border-foreground shadow-[0_0_0_1px_var(--foreground)_inset] bg-accent",
              )}
            >
              {popular && (
                <span className="absolute top-2 right-2 text-[9px] uppercase tracking-[0.08em] px-1.5 py-px rounded-[3px] bg-[oklch(from_var(--info)_l_c_h_/_12%)] text-[var(--info)]">
                  popular
                </span>
              )}
              <div className="flex items-center gap-2">
                <div className="w-[26px] h-[26px] rounded-[5px] bg-muted border border-border grid place-items-center text-muted-foreground">
                  {renderLauncherKindIcon(it, tab, Ic)}
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-[13px]">{it.name}</div>
                </div>
                {active && (
                  <I.check
                    width={12}
                    height={12}
                    className="text-foreground"
                  />
                )}
              </div>
              <div className="text-muted-foreground text-[11px] mt-1.5 leading-[1.45]">
                {it.sub}
              </div>
              {examples && (
                <div className="font-mono text-[10px] text-muted-foreground mt-1.5">
                  {examples}
                </div>
              )}
              {versions && (
                <div className="font-mono text-[10px] text-muted-foreground mt-1.5">
                  versions: {versions.slice(0, 3).join(", ")}
                </div>
              )}
              {services !== undefined && (
                <div className="font-mono text-[10px] text-muted-foreground mt-1.5">
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
