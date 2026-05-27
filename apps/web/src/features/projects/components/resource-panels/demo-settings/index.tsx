import type { ResourceNodeData } from "@/features/projects/components/graph/resource-node";
import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon } from "@hugeicons/core-free-icons";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";

import {
  CapacityBar,
  FeatureFlag,
  SettingsBlock,
  SettingsRow,
  Toggle,
} from "./atoms";
import { SETTINGS_SECTIONS } from "./constants";
import { BuildBlock } from "./build-block";
import { NetworkingBlock } from "./networking-block";
import { ScaleBlock } from "./scale-block";
import { DeployBlock } from "./deploy-block";

interface SettingsTabBodyProps {
  node: ResourceNodeData;
  meta: {
    repo: string;
    domain: string | null;
  };
}

export function SettingsTabBody({ node, meta }: SettingsTabBodyProps) {
  return (
    <div className="grid grid-cols-[1fr_140px] gap-6 pb-10">
      <div className="flex flex-col gap-7">
        <div className="relative">
          <HugeiconsIcon
            icon={Search01Icon}
            strokeWidth={2}
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder="Filter Settings…"
            className="h-8 bg-muted/20 pl-8 pr-9"
          />
          <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            /
          </kbd>
        </div>

        <SettingsBlock title="Source">
          <SettingsRow label="Repository" value={meta.repo} mono />
          <SettingsRow label="Branch" value={node.git?.branch ?? "main"} />
          <SettingsRow label="Auto-deploy on push" value="Enabled" tone="primary" />
        </SettingsBlock>

        <BuildBlock />

        <SettingsBlock title="Health">
          <div className="flex items-center justify-between rounded-lg border border-border/40 px-4 py-3">
            <div>
              <div className="text-[13px] font-medium">Health probe</div>
              <div className="text-[11.5px] text-muted-foreground">
                Otterstack pings this every{" "}
                <span className="text-foreground/80">15s</span>. Replicas that
                fail 3 consecutive checks are restarted.
              </div>
            </div>
            <Toggle on label="enabled" />
          </div>
        </SettingsBlock>

        <SettingsBlock title="Resources">
          <CapacityBar
            label="CPU"
            value="2 vCPU"
            sub="Cluster has 32 vCPU across 3 nodes · 22 free"
            pct={(2 / 32) * 100}
          />
          <CapacityBar
            label="Memory"
            value="2 GB"
            sub="Cluster has 64 GB across 3 nodes · 41 GB free"
            pct={(2 / 64) * 100}
          />
        </SettingsBlock>

        <NetworkingBlock node={node} domain={meta.domain} />

        <ScaleBlock />

        <DeployBlock />

        <SettingsBlock title="Feature flags">
          <FeatureFlag
            title="Run at edge (PoP)"
            sub="Replicate this service to every PoP for cold-start <50ms reads."
          />
          <FeatureFlag
            title="Verbose debug logs"
            sub="Includes request bodies and stack frames in stderr."
          />
          <FeatureFlag
            title="Shadow traffic to staging"
            sub="Mirror 5% of prod requests to the staging environment."
          />
        </SettingsBlock>

        <SettingsBlock title="Danger zone" tone="destructive">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm">
              Pause service
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              Delete service
            </Button>
          </div>
        </SettingsBlock>
      </div>

      <nav className="sticky top-0 self-start text-[12.5px]">
        <ul className="flex flex-col gap-1.5">
          {SETTINGS_SECTIONS.map((s, i) => (
            <li key={s}>
              <a
                href={`#${s.toLowerCase().replace(/ /g, "-")}`}
                className={cn(
                  "block text-right transition-colors hover:text-foreground",
                  i === 4
                    ? "border-r-2 border-foreground pr-3 font-medium text-foreground"
                    : "pr-3 text-muted-foreground",
                )}
              >
                {s}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
