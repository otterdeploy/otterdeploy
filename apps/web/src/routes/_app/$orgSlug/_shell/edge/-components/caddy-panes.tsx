/**
 * The Caddy group's own pieces on the Edge page: the pane links and the
 * rendered-Caddyfile plane (formerly the standalone Networking page).
 */
import { EarthIcon, RefreshIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { useLoaderData } from "@tanstack/react-router";

import { CaddyfileViewer } from "@/features/projects/components/networking/caddyfile-viewer";
import { Button } from "@/shared/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

import { EdgeDefaultsCard } from "./instance-edge";

/** One Caddy-group sidebar entry. A button (not a Link) because the pane is
 *  search-param state on this same route. */
export function CaddyPaneLink({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors",
        active
          ? "bg-muted font-medium text-foreground"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

// ─── Caddyfile plane (formerly the standalone Networking page) ──────────

function useCaddyfileQuery() {
  return useQuery({ ...orpc.system.caddyfile.queryOptions(), retry: false });
}

export function CaddyfileActions() {
  const caddyfile = useCaddyfileQuery();
  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5"
      onClick={() => void caddyfile.refetch()}
      disabled={caddyfile.isFetching}
    >
      <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} className="size-3.5" />
      Refresh
    </Button>
  );
}

export function CaddyfileTab() {
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  const caddyfile = useCaddyfileQuery();

  if (caddyfile.isError) {
    return (
      <Empty className="border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon
              icon={EarthIcon}
              strokeWidth={1.6}
              className="size-5 text-muted-foreground"
            />
          </EmptyMedia>
          <EmptyTitle>Platform access required</EmptyTitle>
          <EmptyDescription>
            The install-wide edge configuration is visible to admins and owners. Per-project
            routes live in each project&apos;s Networking tab.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <CaddyfileViewer
        source={caddyfile.data?.caddyfile ?? ""}
        revision={caddyfile.data?.revision}
        loading={caddyfile.isLoading}
      />
      {/* Edge defaults (ACME email, HTTPS redirect) belong with the config
          they produce; moved here from Instance settings. */}
      <EdgeDefaultsCard organizationId={organization.id} />
    </div>
  );
}
