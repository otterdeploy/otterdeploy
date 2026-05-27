/**
 * Minimal detail panel for a service resource — replicas / status /
 * public flag + a copy block explaining why per-section editors aren't
 * here yet. Once service-specific procedures (logs, env, ports,
 * deployments) ship, this panel grows the same tab shape as
 * RealResourcePanel.
 */

import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";

import { Button } from "@/shared/components/ui/button";

import { PanelIcon } from "./atoms";

interface ServiceResourcePanelProps {
  resource: {
    name: string;
    image: string;
    replicas: number;
    status: string;
    publicEnabled: boolean;
    publicDomain: string | null;
  };
  onClose: () => void;
}

export function ServiceResourcePanel({
  resource,
  onClose,
}: ServiceResourcePanelProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-4 px-6 pt-6">
        <div className="flex items-start gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Back to graph"
            onClick={onClose}
            className="mt-1"
          >
            <HugeiconsIcon
              icon={ArrowLeft01Icon}
              strokeWidth={2}
              className="size-4"
            />
          </Button>
          <PanelIcon
            node={{
              kind: "service",
              name: resource.name,
              description: resource.image,
            }}
          />
          <div className="flex flex-col gap-1">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Service
            </div>
            <div className="text-[20px] font-semibold leading-tight">
              {resource.name}
            </div>
            <div className="font-mono text-[12px] text-muted-foreground">
              {resource.image}
            </div>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close"
          onClick={onClose}
        >
          <HugeiconsIcon
            icon={Cancel01Icon}
            strokeWidth={2}
            className="size-4"
          />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 px-6 pt-5">
        <PanelStat label="Replicas (desired)" value={String(resource.replicas)} />
        <PanelStat label="Status" value={resource.status} />
        <PanelStat
          label="Public"
          value={
            resource.publicEnabled ? (resource.publicDomain ?? "yes") : "private"
          }
        />
      </div>

      <div className="mx-6 mt-6 rounded-md border border-dashed bg-muted/20 p-5 text-[12px] text-muted-foreground">
        Service-specific sections (logs, env, ports, deployments, live replica
        state) land in later D.* slices. The data is in the database and the
        graph node renders correctly — this panel is intentionally minimal until
        the per-section procedures ship.
      </div>
    </div>
  );
}

function PanelStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-card px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-[13px] text-foreground">{value}</div>
    </div>
  );
}
