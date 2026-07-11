import type { ServiceKind } from "@/features/projects/data/service-kinds";

import { PortsAndHealth, StaticBuild } from "./networking-views";

interface StepNetworkingProps {
  kind: ServiceKind | null;
}

// No cron/worker branches: cron is comingSoon-gated (no scheduler exists)
// and portless kinds drop the Networking step from their flow entirely —
// the old per-kind views for them were unreachable fake controls.
export function StepNetworking({ kind }: StepNetworkingProps) {
  if (kind?.id === "static") return <StaticBuild />;
  return <PortsAndHealth />;
}
