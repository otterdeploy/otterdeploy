import { useEffect, useState } from "react";

import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { ConnectDialog } from "@/features/git-providers/connect-dialog";
import {
  ConnectedProviderCard,
  DisconnectedProviderCard,
} from "@/features/git-providers/provider-card";
import {
  type ProviderKind,
  type ProviderView,
} from "@/features/git-providers/shared";
import { orpc, queryClient } from "@/shared/server/orpc";

export const Route = createFileRoute("/_app/$orgSlug/git-providers")({
  staticData: { crumb: "Git providers" },
  validateSearch: (search: Record<string, unknown>) => ({
    git_install: search.git_install as "ok" | "error" | undefined,
    reason: search.reason as string | undefined,
  }),
  component: GitProvidersRoute,
});

function GitProvidersRoute() {
  useInstallCallbackToast();

  const providersQuery = useQuery(
    orpc.git.list.queryOptions({ input: undefined }),
  );
  const providers = (providersQuery.data ?? []) as ProviderView[];
  const [open, setOpen] = useState(false);

  const allKinds: ProviderKind[] = ["github", "gitlab", "gitea", "bitbucket"];
  const byKind = new Map(providers.map((p) => [p.kind, p]));

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-6 py-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[15px] font-semibold tracking-tight">
            Git providers
          </h1>
          <p className="text-[12.5px] text-muted-foreground">
            Source control connections used to deploy services on push.
          </p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
          Connect provider
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        {allKinds.map((kind) => {
          const provider = byKind.get(kind);
          if (provider && provider.installations.length > 0) {
            return <ConnectedProviderCard key={provider.id} provider={provider} />;
          }
          return (
            <DisconnectedProviderCard
              key={kind}
              kind={kind}
              onConnect={() => setOpen(true)}
            />
          );
        })}
      </div>

      <p className="text-[11.5px] leading-relaxed text-muted-foreground">
        Connections install a GitHub App on your account or organization.
        Pushes to a project's production branch trigger an automatic deploy.
      </p>

      <ConnectDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

/**
 * Reads ?git_install=ok|error from the install callback redirect, surfaces
 * a toast, then strips the params from the URL so a refresh doesn't re-fire.
 */
function useInstallCallbackToast() {
  const search = useSearch({ from: "/_app/$orgSlug/git-providers" });

  useEffect(() => {
    if (search.git_install === "ok") {
      toast.success("GitHub connected");
      void queryClient.invalidateQueries({
        queryKey: orpc.git.list.queryKey({ input: undefined }),
      });
      window.history.replaceState({}, "", window.location.pathname);
    } else if (search.git_install === "error") {
      const reason = search.reason ?? "unknown";
      toast.error(`GitHub install failed: ${reason}`);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [search.git_install, search.reason]);
}
