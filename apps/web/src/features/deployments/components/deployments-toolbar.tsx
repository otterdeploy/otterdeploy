/**
 * Filter row for the project Deployments page: free-text search, resource,
 * environment, status, and time window. Values are controlled by the route
 * (which mirrors them into the URL: the URL holds ALL page state); this
 * component is purely presentational. Search input debounces its URL write so
 * typing doesn't fire a request per keystroke.
 */

import { useRef, useState } from "react";

import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";

import { Input } from "@/shared/components/ui/input";
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

export interface EnvironmentOption {
  id: string;
  name: string;
}

const SEARCH_DEBOUNCE_MS = 300;

/** Local echo of the URL's `q` with a debounced write-back. Local state keeps
 *  typing instant; the URL stays the source of truth for everything else
 *  (sharing, reload, back). */
function SearchField({ q, onQChange }: { q: string; onQChange: (value: string) => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Adopt an external URL change (back button, shared link) while not typing.
  const [prevQ, setPrevQ] = useState(q);
  if (q !== prevQ) {
    setPrevQ(q);
    if (timer.current === null) setDraft(q);
  }
  return (
    <div className="relative">
      <HugeiconsIcon
        icon={Search01Icon}
        strokeWidth={2}
        className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        value={draft}
        onChange={(e) => {
          const next = e.target.value;
          setDraft(next);
          if (timer.current !== null) clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            timer.current = null;
            onQChange(next);
          }, SEARCH_DEBOUNCE_MS);
        }}
        placeholder={t("deployments.searchPlaceholder")}
        aria-label={t("deployments.searchPlaceholder")}
        className="h-8 w-64 pl-8"
      />
    </div>
  );
}

export function DeploymentsToolbar({
  resources,
  environments,
  q,
  onQChange,
  service,
  onServiceChange,
  environment,
  onEnvironmentChange,
  status,
  onStatusChange,
  window,
  onWindowChange,
}: {
  resources: ResourceOption[];
  environments: EnvironmentOption[];
  q: string;
  onQChange: (value: string) => void;
  /** Selected resource id, or "all". */
  service: string;
  onServiceChange: (value: string) => void;
  /** Selected environment id, or "all". */
  environment: string;
  onEnvironmentChange: (value: string) => void;
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
  const environmentItems = [
    { label: t("deployments.allEnvironments"), value: "all" },
    ...environments.map((e) => ({ label: e.name, value: e.id })),
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
      <SearchField q={q} onQChange={onQChange} />

      <Select
        items={serviceItems}
        value={service}
        onValueChange={(v) => onServiceChange(v ?? service)}
      >
        <SelectTrigger className="h-8 w-44" aria-label={t("deployments.filterByResource")}>
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

      {/* Environment filter renders only when the project actually has more
          than one environment: a single-env project has nothing to pick. */}
      {environments.length > 1 && (
        <Select
          items={environmentItems}
          value={environment}
          onValueChange={(v) => onEnvironmentChange(v ?? environment)}
        >
          <SelectTrigger className="h-8 w-44" aria-label={t("deployments.filterByEnvironment")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {environmentItems.map((it) => (
              <SelectItem key={it.value} value={it.value}>
                {it.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

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
