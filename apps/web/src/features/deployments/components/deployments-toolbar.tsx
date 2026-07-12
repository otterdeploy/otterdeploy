/**
 * Filter row for the project Deployments page: resource, status, and time
 * window. Values are controlled by the route (which mirrors them into the
 * URL); this component is purely presentational.
 */

import { NativeSelect, NativeSelectOption } from "@/shared/components/ui/native-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";

import {
  DEPLOY_STATUS_FILTERS,
  DEPLOY_WINDOWS,
  type DeployStatusFilter,
  type DeployWindow,
} from "../data/deployments-search";

export interface ResourceOption {
  id: string;
  name: string;
  kind: string;
}

export function DeploymentsToolbar({
  resources,
  service,
  onServiceChange,
  status,
  onStatusChange,
  window,
  onWindowChange,
}: {
  resources: ResourceOption[];
  /** Selected resource id, or "all". */
  service: string;
  onServiceChange: (value: string) => void;
  status: DeployStatusFilter | "any";
  onStatusChange: (value: DeployStatusFilter | "any") => void;
  window: DeployWindow;
  onWindowChange: (value: DeployWindow) => void;
}) {
  // Base UI <SelectValue> renders the selected option's *label* only when the
  // root <Select> gets a matching `items` list (same trick as the audit page).
  const serviceItems = [
    { label: "All resources", value: "all" },
    ...resources.map((r) => ({ label: r.name, value: r.id })),
  ];
  const statusItems = [
    { label: "All statuses", value: "any" },
    ...DEPLOY_STATUS_FILTERS.map((s) => ({ label: s.label, value: s.id })),
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        items={serviceItems}
        value={service}
        onValueChange={(v) => onServiceChange(v ?? service)}
      >
        <SelectTrigger className="h-8 w-48" aria-label="Filter by resource">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {serviceItems.map((it) => (
            <SelectItem key={it.value} value={it.value}>
              {it.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        items={statusItems}
        value={status}
        onValueChange={(v) => onStatusChange((v as DeployStatusFilter | "any") ?? status)}
      >
        <SelectTrigger className="h-8 w-40" aria-label="Filter by status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {statusItems.map((it) => (
            <SelectItem key={it.value} value={it.value}>
              {it.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <NativeSelect
        value={window}
        onChange={(e) => onWindowChange(e.target.value as DeployWindow)}
        className="h-8 w-36"
        aria-label="Time window"
      >
        {DEPLOY_WINDOWS.map((w) => (
          <NativeSelectOption key={w.id} value={w.id}>
            {w.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}
