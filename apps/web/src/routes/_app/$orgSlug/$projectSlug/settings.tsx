/**
 * Project settings — currently focused on the build-pipeline binding
 * (source → image target → nixpacks overrides). Other project-level
 * knobs (rename, delete, custom domain) will join this page over time.
 */

import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { toast } from "sonner";

import { DomainSection } from "@/features/projects/components/settings/domain-section";
import { NixpacksSection } from "@/features/projects/components/settings/nixpacks-section";
import { RegistrySection } from "@/features/projects/components/settings/registry-section";
import { SourceSection } from "@/features/projects/components/settings/source-section";
import {
  buildNixpacksPatch,
  useBindingFormState,
  type ProjectBindingFields,
} from "@/features/projects/components/settings/state";
import { Button } from "@/shared/components/ui/button";
import { orpc, queryClient } from "@/shared/server/orpc";

export const Route = createFileRoute("/_app/$orgSlug/$projectSlug/settings")({
  staticData: { crumb: "Settings" },
  component: SettingsRoute,
});

function SettingsRoute() {
  const { project } = useLoaderData({ from: "/_app/$orgSlug/$projectSlug" });
  return <BindingForm project={project as unknown as ProjectBindingFields} />;
}

function BindingForm({ project }: { project: ProjectBindingFields }) {
  const { state, update, dirty } = useBindingFormState(project);

  const updateMut = useMutation({
    ...orpc.project.update.mutationOptions(),
    onSuccess: () => {
      toast.success("Build settings saved");
      void queryClient.invalidateQueries({
        queryKey: orpc.project.list.queryKey(),
      });
      void queryClient.invalidateQueries({
        queryKey: orpc.project.get.queryKey({ input: { id: project.id as never } }),
      });
    },
    onError: (err) => toast.error(err.message ?? "Failed to save"),
  });

  const onSave = () => {
    updateMut.mutate({
      id: project.id as never,
      customDomain: state.customDomain.trim() || null,
      gitRepoId: (state.gitRepoId ?? null) as never,
      productionBranch: state.productionBranch.trim() || "main",
      containerRegistryId: (state.containerRegistryId ?? null) as never,
      imageRepository: state.imageRepository.trim() || null,
      nixpacksConfig: buildNixpacksPatch(state),
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-6 py-6">
      <header>
        <h1 className="text-[15px] font-semibold tracking-tight">
          Build settings
        </h1>
        <p className="text-[12.5px] text-muted-foreground">
          How this project's services get from a git push to a running container.
        </p>
      </header>

      <DomainSection
        customDomain={state.customDomain}
        verifiedAt={project.customDomainVerifiedAt ?? null}
        onCustomDomainChange={(v) => update("customDomain", v)}
      />

      <SourceSection
        gitRepoId={state.gitRepoId}
        productionBranch={state.productionBranch}
        onGitRepoIdChange={(v) => update("gitRepoId", v)}
        onProductionBranchChange={(v) => update("productionBranch", v)}
      />

      <RegistrySection
        containerRegistryId={state.containerRegistryId}
        imageRepository={state.imageRepository}
        onContainerRegistryIdChange={(v) => update("containerRegistryId", v)}
        onImageRepositoryChange={(v) => update("imageRepository", v)}
      />

      <NixpacksSection
        buildCmd={state.buildCmd}
        startCmd={state.startCmd}
        installCmd={state.installCmd}
        packages={state.packages}
        aptPackages={state.aptPackages}
        onChange={(key, value) => update(key, value)}
      />

      <div className="flex justify-end gap-2 pt-1">
        <Button size="sm" onClick={onSave} disabled={!dirty || updateMut.isPending}>
          {updateMut.isPending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
