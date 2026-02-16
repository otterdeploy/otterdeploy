import { ChevronDown } from "lucide-react";

import { Badge } from "@otterstack/ui/components/ui/badge";
import { Button } from "@otterstack/ui/components/ui/button";

type TopTabsProps = {
  projectName: string;
  environmentName: string;
  onCreateClick: () => void;
};

const tabs = ["Architecture", "Observability", "Logs", "Settings"] as const;

export function TopTabs({ projectName, environmentName, onCreateClick }: TopTabsProps) {
  return (
    <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between border-b border-white/10 bg-[#0c1020]/90 px-5 py-3 backdrop-blur">
      <div className="flex min-w-0 items-center gap-4">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <button className="flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-slate-200">
            <span className="max-w-48 truncate">{projectName}</span>
            <ChevronDown className="size-3.5" />
          </button>
          <span className="text-slate-500">/</span>
          <button className="flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-slate-200">
            <span className="max-w-40 truncate">{environmentName}</span>
            <ChevronDown className="size-3.5" />
          </button>
        </div>
        <div className="hidden items-center gap-1 md:flex">
          {tabs.map((tab) => {
            const active = tab === "Architecture";

            return (
              <button
                key={tab}
                className={active ? "architecture-top-tab architecture-top-tab-active" : "architecture-top-tab"}
              >
                {tab}
                {!active ? <Badge variant="outline" className="ml-1 border-white/20 text-[10px]">Soon</Badge> : null}
              </button>
            );
          })}
        </div>
      </div>
      <Button className="bg-white/10 text-white hover:bg-white/20" onClick={onCreateClick}>
        + Create
      </Button>
    </div>
  );
}
