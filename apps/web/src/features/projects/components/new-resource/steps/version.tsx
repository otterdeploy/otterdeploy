import { useStore } from "@tanstack/react-form";

import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { type ServiceKind } from "@/features/projects/data/service-kinds";
import { DatabaseLogo } from "@/shared/components/brand/database-logo";
import { Card, CardContent } from "@/shared/components/ui/card";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";
import type { Id, ID_PREFIX } from "@otterdeploy/shared/id";

import { useMutation } from "@tanstack/react-query";
import { traitsFor } from "../engine-traits";
import { useFormContext } from "../form-context";
import {
  builderCardActiveClass,
  builderCardClass,
  builderIconClass,
  builderPopClass,
  SectionHeader,
} from "../form-primitives";

interface StepVersionProps {
  kind: ServiceKind;
  projectId: Id<typeof ID_PREFIX.project>;
}

export function StepVersion({ kind, projectId }: StepVersionProps) {
  const form = useFormContext();
  const version = useStore(form.store, (s) => s.values.version);
  const name = useStore(form.store, (s) => s.values.name);

  const existingName = useMutation({
    ...orpc.project.resource.checkName.mutationOptions(),
    onSuccess: (data) => {
      if (!data.available && data.suggestion) {
        form.setFieldValue("name", data.suggestion);
      }
    },
  });

  const traits = traitsFor(kind.id);
  const port = traits.port;

  return (
    <>
      <SectionHeader
        title={`${kind.name} version`}
        sub="Pick a major version — minor versions are auto-upgraded during maintenance windows"
      />
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        {(kind.versions ?? []).map((v, i) => (
          <button
            key={v}
            type="button"
            onClick={() => form.setFieldValue("version", v)}
            className={cn(
              builderCardClass,
              version === v && builderCardActiveClass,
            )}
          >
            {i === 0 && <span className={builderPopClass}>latest</span>}
            <div className="flex items-center gap-2">
              <div className={builderIconClass}>
                <DatabaseLogo value={kind.id} size={14} />
              </div>
              <span className="font-mono text-sm font-semibold">
                {kind.id} {v}
              </span>
              {version === v && (
                <HugeiconsIcon
                  icon={CheckmarkCircle02Icon}
                  strokeWidth={2}
                  className="ml-auto size-4 text-success"
                />
              )}
            </div>
            <div className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
              {i === 0
                ? "Newest stable release · all features available"
                : i === 1
                  ? "Long-term support · stable for production"
                  : "Older release · only choose for legacy compatibility"}
            </div>
          </button>
        ))}
      </div>

      <div className="h-4.5" />
      <SectionHeader title={traits.nameLabel} />
      <Card className="mt-2.5 rounded-md">
        <CardContent>
          <form.AppField
            name="name"
            validators={{
              // Live check on blur. Fires AFTER the user tabs away rather
              // than on every keystroke so we don't hammer the API while
              // they're still typing.
              onBlurAsync: async ({ value }) => {
                const trimmed = (value ?? "").trim();
                if (!trimmed) return undefined;
                const res = await existingName.mutateAsync({
                  projectId,
                  name: trimmed,
                });
                if (res.available) return undefined;
                return res.suggestion
                  ? `'${trimmed}' is already taken in this project — try '${res.suggestion}'`
                  : `'${trimmed}' is already taken in this project`;
              },
            }}
          >
            {(f) => (
              <f.TextField
                label="Service name"
                className="font-mono"
                description={`Reachable at ${name || kind.id}.internal:${port}`}
              />
            )}
          </form.AppField>
        </CardContent>
      </Card>

      <div className="h-4.5" />
      <SectionHeader title="Access" sub={traits.accessSub} />
      <Card className="mt-2.5 rounded-md">
        <CardContent>
          <form.AppField name="publicEnabled">
            {(f) => (
              <f.SwitchField
                label="Expose publicly"
                description={
                  traits.publicExposureRecommended
                    ? "When on, the service is reachable from the internet at the deterministic public hostname. When off, only services in this project can connect."
                    : "Not recommended for this engine. Leave off unless you have a specific reason — this service is exposed to the public internet when on."
                }
              />
            )}
          </form.AppField>
        </CardContent>
      </Card>
    </>
  );
}
