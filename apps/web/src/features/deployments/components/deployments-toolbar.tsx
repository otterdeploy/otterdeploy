/**
 * Filter row for the project Deployments page: resource, status, and time
 * window. Values are controlled by the route (which mirrors them into the
 * URL); this component is purely presentational.
 */

import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
  // Base UI <SelectValue> renders the selected option's *label* only when the
  // root <Select> gets a matching `items` list (same trick as the audit page).
  const serviceItems = [
    { label: t("deployments.allResources"), value: "all" },
    ...resources.map((r) => ({ label: r.name, value: r.id })),
  ];
  const statusItems: { label: string; value: DeployStatusFilter | "any" }[] = [
    { label: t("deployments.allStatuses"), value: "any" },
    ...DEPLOY_STATUS_FILTERS.map((s) => ({
      label: t(`deployments.statuses.${s.id}`),
      value: s.id,
    })),
  ];
  const windowItems = DEPLOY_WINDOWS.map((w) => ({
    label: t(`deployments.windows.${w.id}`),
    value: w.id,
  }));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        items={serviceItems}
        value={service}
        onValueChange={(v) => onServiceChange(v ?? service)}
      >
        <SelectTrigger className="h-8 w-48" aria-label={t("deployments.filterByResource")}>
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
        onValueChange={(v) => {
          const next = statusItems.find((it) => it.value === v);
          if (next) onStatusChange(next.value);
        }}
      >
        <SelectTrigger className="h-8 w-40" aria-label={t("deployments.filterByStatus")}>
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

      <Select
        items={windowItems}
        value={window}
        onValueChange={(v) => {
          const next = DEPLOY_WINDOWS.find((w) => w.id === v);
          if (next) onWindowChange(next.id);
        }}
      >
        <SelectTrigger className="h-8 w-36" aria-label={t("deployments.timeWindow")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {windowItems.map((it) => (
            <SelectItem key={it.value} value={it.value}>
              {it.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
