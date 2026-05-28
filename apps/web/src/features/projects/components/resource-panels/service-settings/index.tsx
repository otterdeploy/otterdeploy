// Settings tab body for a service resource. Read-only identity card +
// a danger zone that stages a manifest delete (mirrors the database
// danger zone but writes to manifest.services instead of .databases).

import type { VariablesEditorResource } from "../postgres-variables/variables-editor";

import { SettingsCard, SettingsRowReadOnly } from "../postgres-settings/atoms";
import { ServiceDangerZone } from "./danger-zone";

export interface ServiceSettingsResource extends VariablesEditorResource {
  name: string;
  image: string;
  replicas: number;
  publicEnabled: boolean;
  publicDomain: string | null;
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
        <SettingsRowReadOnly
          label="Public"
          value={
            resource.publicEnabled
              ? (resource.publicDomain ?? "yes")
              : "private"
          }
        />
      </SettingsCard>

      <ServiceDangerZone resource={resource} onDeleted={onDeleted} />
    </div>
  );
}
