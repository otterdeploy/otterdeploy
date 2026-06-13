// Settings tab body for a service resource. Read-only identity card +
// a danger zone that stages a manifest delete (mirrors the database
// danger zone but writes to manifest.services instead of .databases).

import type { VariablesEditorResource } from "@/features/resources/components/_shared/variables-editor";

import { SettingsCard, SettingsRowReadOnly } from "@/features/resources/components/_shared/settings-card";
import { ServiceBuildCard } from "./build-card";
import { ServiceDangerZone } from "./danger-zone";
import { ServiceProtectionCard } from "./protection-card";
import { ServicePublicAccessCard } from "./public-access-card";

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
}

export function ServiceSettingsBody({
  resource,
  onDeleted,
}: ServiceSettingsBodyProps) {
  return (
    <div className="flex flex-col gap-6">
      <SettingsCard
        title="Identity"
        description="Renaming is not yet supported — once it lands the change will rotate the derived service name + internal hostname."
      >
        <SettingsRowReadOnly label="Name" value={resource.name} />
        <SettingsRowReadOnly label="Image" value={resource.image} />
        <SettingsRowReadOnly
          label="Replicas (desired)"
          value={String(resource.replicas)}
        />
      </SettingsCard>

      {resource.source === "git" ? (
        <ServiceBuildCard resource={resource} />
      ) : null}

      <ServicePublicAccessCard resource={resource} />

      <ServiceProtectionCard resource={resource} />

      <ServiceDangerZone resource={resource} onDeleted={onDeleted} />
    </div>
  );
}
