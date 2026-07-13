/**
 * Project settings. Git source + image target now live on each SERVICE (a
 * project can hold services that build from different repos), so this page is
 * project-level only: the custom domain its services land on. Per-service
 * source/build/image config — including the PR-previews opt-in — is edited in
 * the service's Settings → Source card.
 */

import { useForm, useStore } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { toast } from "sonner";

import { ProjectDangerZone } from "@/features/projects/components/settings/danger-zone";
import { DomainSection } from "@/features/projects/components/settings/domain-section";
import { Button } from "@/shared/components/ui/button";
import { orpc, queryClient } from "@/shared/server/orpc";

export const Route = createFileRoute("/_app/$orgSlug/_shell/$projectSlug/settings")({
  staticData: { crumb: "Settings" },
  component: SettingsRoute,
});

interface ProjectSettingsFields {
  id: string;
  name: string;
  slug: string;
  customDomain: string | null;
  customDomainVerifiedAt: Date | null;
}

function SettingsRoute() {
  const { project } = useLoaderData({ from: "/_app/$orgSlug/_shell/$projectSlug" });
  return <SettingsForm project={project as unknown as ProjectSettingsFields} />;
}

function SettingsForm({ project }: { project: ProjectSettingsFields }) {
  const { orgSlug } = Route.useParams();

  const updateMut = useMutation({
    ...orpc.project.update.mutationOptions(),
    onSuccess: () => {
      toast.success("Settings saved");
      void queryClient.invalidateQueries({ queryKey: orpc.project.list.queryKey() });
      void queryClient.invalidateQueries({
        queryKey: orpc.project.get.queryKey({ input: { id: project.id } }),
      });
    },
    onError: (err) => toast.error(err.message ?? "Failed to save"),
  });

  const form = useForm({
    defaultValues: { customDomain: project.customDomain ?? "" },
    onSubmit: ({ value }) => {
      updateMut.mutate({
        id: project.id,
        customDomain: value.customDomain.trim() || null,
      });
    },
  });
  const customDomain = useStore(form.store, (s) => s.values.customDomain);
  const dirty = customDomain.trim() !== (project.customDomain ?? "");

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-6 py-6">
      <header>
        <h1 className="text-[15px] font-semibold tracking-tight">Settings</h1>
        <p className="text-[12.5px] text-muted-foreground">
          Project-level settings. A service's git source, build, image target, and PR-preview
          opt-in are set on the service itself, under Settings → Source.
        </p>
      </header>

      <DomainSection
        customDomain={customDomain}
        verifiedAt={project.customDomainVerifiedAt ?? null}
        onCustomDomainChange={(v) => form.setFieldValue("customDomain", v)}
      />

      <div className="flex justify-end gap-2 pt-1">
        <Button
          size="sm"
          onClick={() => void form.handleSubmit()}
          disabled={!dirty || updateMut.isPending}
        >
          {updateMut.isPending ? "Saving…" : "Save changes"}
        </Button>
      </div>

      <ProjectDangerZone project={project} orgSlug={orgSlug} />
    </div>
  );
}
