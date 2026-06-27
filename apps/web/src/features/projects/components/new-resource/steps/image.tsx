/**
 * Image step — choose a pre-built docker image. Used by the "Custom
 * docker image" flow (DOCKER_STEPS in flows.ts) and submitted via
 * orpc.service.create with source="image".
 *
 * Registry picker reads the org's container_registry rows directly
 * (orpc.registry.list). When no credentials are configured the user
 * is nudged toward /registries — until then the picker shows
 * "anonymous pull" as the only option, which works for public
 * images (Docker Hub, GHCR public, etc.).
 */

import { useLiveQuery } from "@tanstack/react-db";
import { useStore } from "@tanstack/react-form";

import { registryCollection } from "@/features/registries/data/registries";
import { Card, CardContent } from "@/shared/components/ui/card";
import { cn } from "@/shared/lib/utils";

import { useFormContext } from "../form-context";
import { SectionHeader, builderCardClass, builderCardActiveClass } from "../form-primitives";
import { I } from "../icons";

const ANONYMOUS = {
  id: "",
  displayName: "Anonymous pull",
  host: "any",
  sub: "Public images (Docker Hub, GHCR public, …)",
};

export function StepImage() {
  const form = useFormContext();
  const registryId = useStore(form.store, (s) => s.values.registry as string);
  const image = useStore(form.store, (s) => s.values.image as string);
  const tag = useStore(form.store, (s) => s.values.tag as string);

  const { data: registries } = useLiveQuery((q) => q.from({ r: registryCollection }));

  const options: Array<{
    id: string;
    displayName: string;
    host: string;
    sub: string;
  }> = [
    ANONYMOUS,
    ...registries.map((r) => ({
      id: r.id,
      displayName: r.displayName,
      host: r.host,
      sub: `${r.username}@${r.host} · ${r.authType}`,
    })),
  ];

  return (
    <>
      <SectionHeader title="Container registry" />
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        {options.map((r) => (
          <button
            key={r.id || "anon"}
            type="button"
            onClick={() => form.setFieldValue("registry", r.id)}
            className={cn(builderCardClass, registryId === r.id && builderCardActiveClass)}
          >
            <div className="flex items-center gap-2">
              <I.service width={13} height={13} />
              <div className="text-[13px] font-semibold">{r.displayName}</div>
            </div>
            <div className="mt-1 font-mono text-[11px] text-muted-foreground">{r.host}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">{r.sub}</div>
          </button>
        ))}
      </div>
      {registries.length === 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          No private registries configured. Public images work without one — add a credential under{" "}
          <span className="font-mono">Settings → Registries</span> to pull from a private host.
        </p>
      )}

      <div className="mt-5">
        <SectionHeader title="Image" />
      </div>
      <Card className="mt-2.5 rounded-md">
        <CardContent className="flex flex-col gap-2">
          <div className="grid grid-cols-[2fr_1fr] gap-2.5">
            <form.AppField name="image">
              {(f) => (
                <f.TextField label="Image" className="font-mono" placeholder="ghcr.io/owner/repo" />
              )}
            </form.AppField>
            <form.AppField name="tag">
              {(f) => <f.TextField label="Tag" className="font-mono" placeholder="latest" />}
            </form.AppField>
          </div>
          <div className="font-mono text-[11px] text-muted-foreground">
            resolved →{" "}
            <span className="text-foreground">
              {image || "…"}:{tag || "latest"}
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="mt-4">
        <SectionHeader title="Service name" />
      </div>
      <Card className="mt-2.5 rounded-md">
        <CardContent>
          <form.AppField name="name">
            {(f) => <f.TextField label="Name" className="font-mono" />}
          </form.AppField>
        </CardContent>
      </Card>
    </>
  );
}
