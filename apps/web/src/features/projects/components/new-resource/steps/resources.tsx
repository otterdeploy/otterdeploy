import { useStore } from "@tanstack/react-form";

import { RESOURCE_PRESETS } from "@/features/projects/data/service-kinds";
import { Card, CardContent } from "@/shared/components/ui/card";

import { useFormContext } from "../form-context";
import { SectionHeader } from "../form-primitives";
import { PlacementSection, useSwarmNodes } from "./resources-placement";
import { ReplicasSection, SizePresets } from "./resources-size";

interface StepResourcesProps {
  isDb: boolean;
}

export function StepResources({ isDb }: StepResourcesProps) {
  const form = useFormContext();
  const presetId = useStore(form.store, (s) => s.values.presetId);
  const customCpu = useStore(form.store, (s) => s.values.customCpu);
  const customMem = useStore(form.store, (s) => s.values.customMem);
  const replicas = useStore(form.store, (s) => s.values.replicas);

  const preset = RESOURCE_PRESETS.find((p) => p.id === presetId);
  const cpu = preset?.cpu ?? customCpu;
  const mem = preset?.mem ?? customMem;
  const totalCpu = (cpu * replicas).toFixed(2);
  const totalMem = ((mem * replicas) / 1024).toFixed(2);

  const { nodes, loading: nodesLoading } = useSwarmNodes();
  const clusterCpu = nodes.reduce(
    (acc, n) => ({ total: acc.total + n.cpuTotal, used: acc.used + n.cpuUsed }),
    { total: 0, used: 0 },
  );
  const clusterMem = nodes.reduce(
    (acc, n) => ({
      total: acc.total + n.memTotalGb,
      used: acc.used + n.memUsedGb,
    }),
    { total: 0, used: 0 },
  );
  const sizeSub = nodesLoading
    ? "Reading swarm capacity…"
    : nodes.length === 0
      ? "No swarm nodes registered — register one before deploying."
      : `Cluster has ${clusterCpu.total} vCPU across ${nodes.length} ${nodes.length === 1 ? "node" : "nodes"} · ${Math.max(0, clusterCpu.total - clusterCpu.used).toFixed(1)} free · ${Math.max(0, clusterMem.total - clusterMem.used).toFixed(0)} GB memory free`;

  return (
    <>
      <SectionHeader title="Size" sub={sizeSub} />
      <SizePresets />

      {!isDb && <ReplicasSection />}

      <PlacementSection />

      <Card className="mt-3.5 rounded-md bg-muted py-3.5">
        <CardContent className="px-3.5">
          <div className="flex items-center gap-3">
            <div>
              <div className="text-[10px] tracking-[0.06em] text-muted-foreground uppercase">
                service total
              </div>
              <div className="mt-0.5 font-mono text-sm font-medium">
                {totalCpu} vCPU · {totalMem} GB
              </div>
            </div>
            <div className="flex-1" />
          </div>
        </CardContent>
      </Card>
    </>
  );
}
