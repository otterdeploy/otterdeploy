/**
 * Project settings. Git source + image target now live on each SERVICE (a
 * project can hold services that build from different repos), so this page is
 * project-level only: the custom domain its services land on. Per-service
 * source/build/image config is edited in the service's Settings → Source card.
 */

import { useState } from "react";

import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { toast } from "sonner";

import { DomainSection } from "@/features/projects/components/settings/domain-section";
import { Button } from "@/shared/components/ui/button";
import { Label } from "@/shared/components/ui/label";
import { Switch } from "@/shared/components/ui/switch";
import { orpc, queryClient } from "@/shared/server/orpc";

export const Route = createFileRoute("/_app/$orgSlug/$projectSlug/settings")({
  staticData: { crumb: "Settings" },
  component: SettingsRoute,
});

interface ProjectSettingsFields {
  id: string;
  customDomain: string | null;
  customDomainVerifiedAt: Date | null;
  previewsEnabled: boolean;
}

function SettingsRoute() {
  const { project } = useLoaderData({ from: "/_app/$orgSlug/$projectSlug" });
  return <SettingsForm project={project as unknown as ProjectSettingsFields} />;
}

function SettingsForm({ project }: { project: ProjectSettingsFields }) {
  const [customDomain, setCustomDomain] = useState(project.customDomain ?? "");
  const [previewsEnabled, setPreviewsEnabled] = useState(project.previewsEnabled);
  const dirty =
    customDomain.trim() !== (project.customDomain ?? "") ||
    previewsEnabled !== project.previewsEnabled;

  const updateMut = useMutation({
    ...orpc.project.update.mutationOptions(),
    onSuccess: () => {
      toast.success("Settings saved");
      void queryClient.invalidateQueries({ queryKey: orpc.project.list.queryKey() });
      void queryClient.invalidateQueries({
        queryKey: orpc.project.get.queryKey({ input: { id: project.id as never } }),
      });
    },
    onError: (err) => toast.error(err.message ?? "Failed to save"),
  });

  const onSave = () => {
    updateMut.mutate({
      id: project.id as never,
      customDomain: customDomain.trim() || null,
      previewsEnabled,
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-6 py-6">
      <header>
        <h1 className="text-[15px] font-semibold tracking-tight">Settings</h1>
        <p className="text-[12.5px] text-muted-foreground">
          Project-level settings. A service's git source, build, and image target are set on the
          service itself, under Settings → Source.
        </p>
      </header>

      <DomainSection
        customDomain={customDomain}
        verifiedAt={project.customDomainVerifiedAt ?? null}
        onCustomDomainChange={setCustomDomain}
      />

      <section className="rounded-md border bg-card p-5">
        <header className="mb-3">
          <h2 className="text-[14px] font-semibold">Preview deployments</h2>
          <p className="text-[12.5px] text-muted-foreground">
            When on, opening or updating a pull request on a repo bound to this project's services
            spins up an isolated preview environment — a separate container and branched database,
            running alongside production without replacing it. Off by default.
          </p>
        </header>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="proj-previews-enabled" className="text-[13px]">
            Deploy previews for pull requests
          </Label>
          <Switch
            id="proj-previews-enabled"
            checked={previewsEnabled}
            onCheckedChange={setPreviewsEnabled}
          />
        </div>
      </section>

      <div className="flex justify-end gap-2 pt-1">
        <Button size="sm" onClick={onSave} disabled={!dirty || updateMut.isPending}>
          {updateMut.isPending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
