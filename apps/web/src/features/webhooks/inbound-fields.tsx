/**
 * Target-action fields for the inbound-endpoint dialog — the action select
 * and the service picker it reveals for `redeploy`. Split out of
 * `inbound-dialog.tsx` to keep that module within the file-size budget.
 */

import { useTranslation } from "react-i18next";

import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";

export type InboundAction = "redeploy" | "none";

export function TargetFields({
  action,
  onActionChange,
  resourceId,
  onResourceIdChange,
  services,
}: {
  action: InboundAction;
  onActionChange: (a: InboundAction) => void;
  resourceId: string;
  onResourceIdChange: (id: string) => void;
  services: { resourceId: string; projectSlug: string; name: string }[] | undefined;
}) {
  const { t } = useTranslation();
  const actionItems: { label: string; value: InboundAction }[] = [
    { value: "redeploy", label: t("webhooks.redeployService") },
    { value: "none", label: t("webhooks.recordOnly") },
  ];
  const serviceItems = (services ?? []).map((s) => ({
    value: s.resourceId,
    label: `${s.projectSlug} / ${s.name}`,
  }));
  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor="inbound-action">{t("webhooks.targetAction")}</Label>
        <Select
          items={actionItems}
          value={action}
          onValueChange={(v) => {
            const next = actionItems.find((it) => it.value === v);
            if (next) onActionChange(next.value);
          }}
        >
          <SelectTrigger id="inbound-action" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {actionItems.map((it) => (
              <SelectItem key={it.value} value={it.value}>
                {it.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {action === "redeploy" && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="inbound-service">{t("deployments.columns.service")}</Label>
          <Select
            items={serviceItems}
            value={resourceId === "" ? null : resourceId}
            onValueChange={(v) => onResourceIdChange(typeof v === "string" ? v : "")}
          >
            <SelectTrigger id="inbound-service" className="w-full">
              <SelectValue
                placeholder={
                  services === undefined
                    ? t("webhooks.servicesLoading")
                    : services.length === 0
                      ? t("webhooks.servicesEmpty")
                      : t("webhooks.servicePlaceholder")
                }
              />
            </SelectTrigger>
            <SelectContent>
              {serviceItems.map((it) => (
                <SelectItem key={it.value} value={it.value}>
                  {it.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </>
  );
}
