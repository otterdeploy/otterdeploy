/**
 * Image step — choose a pre-built docker image. Used by the "Custom
 * docker image" flow (DOCKER_STEPS in flows.ts) and submitted via
 * orpc.service.create with source="image".
 *
 * Registry picker reads the org's container_registry rows directly
 * (orpc.registry.list), rendered with the same host→brand mapping the
 * Registries settings page uses. Honesty note: at DEPLOY time pull
 * credentials are matched by the image's host (resolveRegistryAuth), not
 * by this pick — the pick drives the tag browser's auth and documents
 * intent. "Anonymous pull" works for public images.
 *
 * The tag browser (image-tags.tsx) lists real tags via registry.listTags;
 * picking one fills the tag field. The demo's watch-tag / cosign /
 * re-pull toggles were deliberately NOT ported: nothing in the deploy
 * pipeline polls digests or verifies signatures, so they'd be fake.
 */

import { useLiveQuery } from "@tanstack/react-db";
import { useStore } from "@tanstack/react-form";

import { registryCollection } from "@/features/registries/data/registries";
import { REGISTRY_KIND_META, kindForHost } from "@/features/registries/registry-kinds";
import { SvglLogo } from "@/shared/components/brand/svgl-logo";
import { Card, CardContent } from "@/shared/components/ui/card";
import { cn } from "@/shared/lib/utils";

import { useFormContext } from "../form-context";
import { SectionHeader, builderCardClass, builderCardActiveClass } from "../form-primitives";
import { I } from "../icons";
import { ImageTagBrowser } from "./image-tags";

const ANONYMOUS = {
  id: "",
  displayName: "Anonymous pull",
  host: "any public registry",
  sub: "Public images (Docker Hub, GHCR public, …)",
  brand: null as string | null,
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
    brand: string | null;
  }> = [
    ANONYMOUS,
    ...registries.map((r) => ({
      id: r.id,
      displayName: r.displayName,
      host: r.host,
      sub: `${r.username}@${r.host} · ${r.authType}`,
      brand: REGISTRY_KIND_META[kindForHost(r.host)].brand,
    })),
  ];

  return (
    <>
      <SectionHeader
        title="Container registry"
        sub="Used to browse tags below. At deploy time the pull credential is matched by the image's host automatically."
      />
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        {options.map((r) => (
          <button
            key={r.id || "anon"}
            type="button"
            onClick={() => form.setFieldValue("registry", r.id)}
            className={cn(builderCardClass, registryId === r.id && builderCardActiveClass)}
          >
            <div className="flex items-center gap-2">
              {r.brand ? (
                <SvglLogo
                  search={r.brand}
                  fallback={r.host}
                  size={16}
                  background="transparent"
                  border="0"
                  color="currentColor"
                  style={{ borderRadius: 0 }}
                />
              ) : (
                <I.service width={13} height={13} />
              )}
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

      <ImageTagBrowser
        image={image}
        registryId={registryId}
        tag={tag}
        onPick={(t) => form.setFieldValue("tag", t)}
      />

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
