/**
 * Target-action fields for the inbound-endpoint dialog — the action select
 * and the service picker it reveals for `redeploy`. Split out of
 * `inbound-dialog.tsx` to keep that module within the file-size budget.
 */

import { Label } from "@/shared/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/shared/components/ui/native-select";

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
  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor="inbound-action">Target action</Label>
        <NativeSelect
          className="w-full"
          id="inbound-action"
          value={action}
          onChange={(e) => onActionChange(e.target.value as InboundAction)}
        >
          <NativeSelectOption value="redeploy">Redeploy a service</NativeSelectOption>
          <NativeSelectOption value="none">Nothing — record the invocation</NativeSelectOption>
        </NativeSelect>
      </div>

      {action === "redeploy" && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="inbound-service">Service</Label>
          <NativeSelect
            className="w-full"
            id="inbound-service"
            value={resourceId}
            onChange={(e) => onResourceIdChange(e.target.value)}
          >
            <NativeSelectOption value="">
              {services === undefined
                ? "Loading services…"
                : services.length === 0
                  ? "No services in this workspace yet"
                  : "Pick a service…"}
            </NativeSelectOption>
            {services?.map((s) => (
              <NativeSelectOption key={s.resourceId} value={s.resourceId}>
                {s.projectSlug} / {s.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      )}
    </>
  );
}
