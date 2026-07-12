// Settings tab body for a service resource. Read-only identity card +
// a danger zone that stages a manifest delete (mirrors the database
// danger zone but writes to manifest.services instead of .databases).

import type { VariablesEditorResource } from "@/features/resources/components/_shared/variables-editor";

import {
  SettingsCard,
  SettingsRowReadOnly,
} from "@/features/resources/components/_shared/settings-card";

import { ServiceBuildCard } from "./build-card";
import { ServiceDangerZone } from "./danger-zone";
import { ServiceDeployHooksCard } from "./deploy-hooks-card";
import { ServiceDomainsCard } from "./domains-card";
import { ServiceHealthCheckCard } from "./health-check-card";
import { ManifestDomainsCard } from "./manifest-domains-card";
import { ManifestPortsCard } from "./manifest-ports-card";
import { ServiceProtectionCard } from "./protection-card";
import { ServicePublicAccessCard } from "./public-access-card";
import { ServiceScalingCard } from "./scaling-card";
import { ServiceSourceCard } from "./source-card";

export interface ServiceSettingsResource extends VariablesEditorResource {
  name: string;
  image: string;
  replicas: number;
  publicEnabled: boolean;
  publicDomain: string | null;
  source: "image" | "git" | "upload";
  // Stored railpack/dockerfile/… config. Optional + `unknown` to match the
  // resource-list contract; the build card narrows it.
  buildConfig?: unknown;
}

interface ServiceSettingsBodyProps {
  resource: ServiceSettingsResource;
  onDeleted: () => void;
  // Pending-create mode: the service isn't provisioned, so resource-scoped
  // cards (live public-access toggle, protection, DNS recheck) don't apply.
  // Editing targets the manifest entry instead.
  pending?: boolean;
}

export function ServiceSettingsBody({
  resource,
  onDeleted,
  pending = false,
}: ServiceSettingsBodyProps) {
  return (
    <div className="flex flex-col gap-6">
      {/* Rename stays read-only on purpose: the name derives the runtime
          container/service name, the internal DNS hostname, and the target of
          `${{name.VAR}}` variable references — a rename would rotate all
          three. Honest note over a broken affordance. */}
      <SettingsCard
        title="Identity"
        description="Renaming is not yet supported — once it lands the change will rotate the derived service name + internal hostname."
      >
        <SettingsRowReadOnly label="Name" value={resource.name} />
        <SettingsRowReadOnly label="Image" value={resource.image} />
        <SettingsRowReadOnly label="Replicas (desired)" value={String(resource.replicas)} />
      </SettingsCard>

      {resource.source === "git" ? (
        <>
          <ServiceSourceCard resource={resource} />
          <ServiceBuildCard resource={resource} />
          <ServiceDeployHooksCard projectId={resource.projectId} serviceName={resource.name} />
        </>
      ) : null}

      {pending ? (
        // Manifest-backed ports + domains; the live scaling / public-access /
        // protection cards need a running resource, so they're omitted until
        // after Deploy. Ports come first — a public URL needs an http+primary
        // port, which the domains card below then attaches to.
        <>
          <ManifestPortsCard projectId={resource.projectId} serviceName={resource.name} />
          <ManifestDomainsCard projectId={resource.projectId} serviceName={resource.name} />
        </>
      ) : (
        <>
          {/* Runtime-scoped: reads/writes the live service row via
              service.get/update, so they're omitted for a staged create. */}
          <ServiceScalingCard resource={resource} />
          <ServiceHealthCheckCard resource={resource} />
          <ServicePublicAccessCard resource={resource} />
          <ServiceDomainsCard resource={resource} />
          <ServiceProtectionCard resource={resource} />
        </>
      )}

      <ServiceDangerZone resource={resource} onDeleted={onDeleted} pending={pending} />
    </div>
  );
}
