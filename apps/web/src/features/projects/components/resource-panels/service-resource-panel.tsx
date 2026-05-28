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

// Build config + preDeploy + restartWindowMs + disk/swap/pids land here
// from the manifest sync path. The wizard doesn't author them yet — for
// now this panel surfaces whatever has been set so operators can confirm
// the manifest applied.
type BuildSummary =
  | { builder: "auto"; watchPatterns?: string[] }
  | { builder: "dockerfile"; dockerfilePath?: string | null; watchPatterns?: string[] }
  | {
      builder: "nixpacks";
      buildCommand?: string | null;
      nixpacksConfigPath?: string | null;
      watchPatterns?: string[];
    }
  | {
      builder: "railpack";
      buildCommand?: string | null;
      watchPatterns?: string[];
    }
  | {
      builder: "compose";
      composePath?: string | null;
      watchPatterns?: string[];
    };

interface ServiceResourcePanelProps {
  resource: {
    name: string;
    image: string;
    replicas: number;
    status: string;
    publicEnabled: boolean;
    publicDomain: string | null;
    preDeploy?: string[] | null;
    // The contract types this as unknown (jsonb passthrough) so we
    // narrow at use-site below.
    buildConfig?: unknown;
    restartWindowMs?: number | null;
    diskLimitMb?: number | null;
    swapLimitMb?: number | null;
    pidsLimit?: number | null;
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

      <ManifestExtras resource={resource} />

      <div className="mx-6 mt-6 rounded-md border border-dashed bg-muted/20 p-5 text-[12px] text-muted-foreground">
        Service-specific sections (logs, env, ports, deployments, live replica
        state) land in later D.* slices. The data is in the database and the
        graph node renders correctly — this panel is intentionally minimal until
        the per-section procedures ship.
      </div>
    </div>
  );
}

// Read-only display of manifest-authored fields the wizard doesn't ship yet.
// Renders nothing when every field is null/undefined.
function ManifestExtras({
  resource,
}: {
  resource: ServiceResourcePanelProps["resource"];
}) {
  const build = narrowBuildConfig(resource.buildConfig);
  const buildSummary = build ? summarizeBuild(build) : null;
  const watchPatterns = build?.watchPatterns;
  const hasExtras =
    buildSummary != null ||
    (resource.preDeploy && resource.preDeploy.length > 0) ||
    resource.restartWindowMs != null ||
    resource.diskLimitMb != null ||
    resource.swapLimitMb != null ||
    resource.pidsLimit != null;
  if (!hasExtras) return null;
  return (
    <div className="mx-6 mt-5 flex flex-col gap-3">
      {buildSummary && <PanelStat label="Build" value={buildSummary} />}
      {watchPatterns && watchPatterns.length > 0 && (
        <PanelStat label="Watch patterns" value={watchPatterns.join(", ")} />
      )}
      {resource.preDeploy && resource.preDeploy.length > 0 && (
        <PanelStat label="Pre-deploy" value={resource.preDeploy.join(" ")} />
      )}
      <div className="grid grid-cols-2 gap-3">
        {resource.restartWindowMs != null && (
          <PanelStat
            label="Restart window"
            value={`${resource.restartWindowMs} ms`}
          />
        )}
        {resource.diskLimitMb != null && (
          <PanelStat label="Disk limit" value={`${resource.diskLimitMb} MB`} />
        )}
        {resource.swapLimitMb != null && (
          <PanelStat label="Swap limit" value={`${resource.swapLimitMb} MB`} />
        )}
        {resource.pidsLimit != null && (
          <PanelStat label="PIDs limit" value={String(resource.pidsLimit)} />
        )}
      </div>
    </div>
  );
}

// Narrow `unknown` (from the contract's jsonb passthrough) to BuildSummary.
// Returns null if the shape doesn't look like a known build config.
function narrowBuildConfig(value: unknown): BuildSummary | null {
  if (!value || typeof value !== "object") return null;
  const builder = (value as { builder?: unknown }).builder;
  if (
    builder !== "auto" &&
    builder !== "dockerfile" &&
    builder !== "nixpacks" &&
    builder !== "railpack" &&
    builder !== "compose"
  )
    return null;
  return value as BuildSummary;
}

function summarizeBuild(build: BuildSummary): string {
  switch (build.builder) {
    case "auto":
      return "auto-detect";
    case "dockerfile":
      return `dockerfile · ${build.dockerfilePath ?? "./Dockerfile"}`;
    case "nixpacks": {
      const cmd = build.buildCommand ? ` · ${build.buildCommand}` : "";
      return `nixpacks${cmd}`;
    }
    case "railpack": {
      const cmd = build.buildCommand ? ` · ${build.buildCommand}` : "";
      return `railpack${cmd}`;
    }
    case "compose":
      return `compose · ${build.composePath ?? "./docker-compose.yml"}`;
  }
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
