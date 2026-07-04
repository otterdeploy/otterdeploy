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
import { ManifestDomainsCard } from "./manifest-domains-card";
import { ServiceProtectionCard } from "./protection-card";
import { ServicePublicAccessCard } from "./public-access-card";
import { ServiceSourceCard } from "./source-card";

export interface ServiceSettingsResource extends VariablesEditorResource {
  name: string;
  image: string;
  replicas: number;
  publicEnabled: boolean;
  publicDomain: string | null;
  source: "image" | "git";
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
        // Manifest-backed domains; the live public-access + protection cards
        // need a running resource, so they're omitted until after Deploy.
        <ManifestDomainsCard projectId={resource.projectId} serviceName={resource.name} />
      ) : (
        <>
          <ServicePublicAccessCard resource={resource} />
          <ServiceDomainsCard resource={resource} />
          <ServiceProtectionCard resource={resource} />
        </>
      )}

      <ServiceDangerZone resource={resource} onDeleted={onDeleted} pending={pending} />
    </div>
  );
}
