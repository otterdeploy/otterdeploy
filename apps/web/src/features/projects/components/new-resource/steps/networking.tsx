import type { ServiceKind } from "@/features/projects/data/service-kinds";

import { CronSchedule, PortsAndHealth, StaticBuild, WorkerNetworking } from "./networking-views";

interface StepNetworkingProps {
  kind: ServiceKind | null;
}

export function StepNetworking({ kind }: StepNetworkingProps) {
  if (kind?.id === "cron") return <CronSchedule />;
  if (kind?.id === "worker") return <WorkerNetworking />;
  if (kind?.id === "static") return <StaticBuild />;
  return <PortsAndHealth />;
}
