import type { GitProviderId } from "@otterdeploy/shared/id";

import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import {
  DeleteButton,
  GeneralTab,
  PermissionsTab,
  ResourcesTab,
} from "@/features/git-providers/app-detail";
import { Page, PageHeader } from "@/shared/components/page";
import { ErrorState } from "@/shared/components/ui/error-state";
import { Spinner } from "@/shared/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { orpc, queryClient } from "@/shared/server/orpc";

export const Route = createFileRoute("/_app/$orgSlug/github-app/$providerId")({
  staticData: { crumb: "GitHub App" },
  component: GitProviderDetailRoute,
});

function GitProviderDetailRoute() {
  const { orgSlug, providerId } = Route.useParams();
  const navigate = useNavigate();

  const query = useQuery(
    orpc.git.getProvider.queryOptions({ input: { providerId: providerId as GitProviderId } }),
  );

  const del = useMutation({
    ...orpc.git.deleteProvider.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.git.list.queryKey({ input: undefined }),
      });
      toast.success("GitHub App deleted");
      void navigate({ to: "/$orgSlug/git-providers", params: { orgSlug } });
    },
    onError: (err) => toast.error(err.message ?? "Delete failed"),
  });

  if (query.isLoading) {
    return (
      <Page>
        <div className="flex flex-1 items-center justify-center py-20">
          <Spinner className="size-5" />
        </div>
      </Page>
    );
  }

  if (query.isError || !query.data) {
    return (
      <Page>
        <ErrorState
          title="Couldn't load this GitHub App"
          message={query.error?.message}
          onRetry={() => void query.refetch()}
        />
      </Page>
    );
  }

  const provider = query.data;

  return (
    <Page>
      <PageHeader
        title={provider.displayName}
        description="GitHub App used to deploy this organization's services on push."
        actions={
          <DeleteButton
            pending={del.isPending}
            onDelete={() => del.mutate({ providerId: providerId as GitProviderId })}
          />
        }
      />

      <Tabs defaultValue="general" className="gap-5">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="permissions">Permissions</TabsTrigger>
          <TabsTrigger value="resources">Resources</TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <GeneralTab provider={provider} />
        </TabsContent>
        <TabsContent value="permissions">
          <PermissionsTab provider={provider} />
        </TabsContent>
        <TabsContent value="resources">
          <ResourcesTab orgSlug={orgSlug} providerId={providerId as GitProviderId} />
        </TabsContent>
      </Tabs>
    </Page>
  );
}
