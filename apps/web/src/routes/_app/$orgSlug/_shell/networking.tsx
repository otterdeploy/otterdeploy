/**
 * Org-level Networking — the install-wide edge view. Shows the full rendered
 * Caddyfile exactly as the reconciler assembles it (every project's site
 * blocks + the global options block, CrowdSec credentials masked
 * server-side). Gated on `platform:read`, so plain members get an honest
 * permission notice instead of install-wide config. Edge defaults (ACME
 * email, HTTPS redirect) are edited in Settings → Instance — this page links
 * there rather than duplicating the form.
 */
import { ArrowRight01Icon, EarthIcon, RefreshIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";

import { CaddyfileViewer } from "@/features/projects/components/networking/caddyfile-viewer";
import { Button } from "@/shared/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import { Page, PageHeader } from "@/shared/components/page";
import { orpc } from "@/shared/server/orpc";

export const Route = createFileRoute("/_app/$orgSlug/_shell/networking")({
  staticData: { crumb: "Networking" },
  component: RouteComponent,
});

function RouteComponent() {
  const { orgSlug } = useParams({ from: "/_app/$orgSlug/_shell/networking" });
  const caddyfile = useQuery({
    ...orpc.system.caddyfile.queryOptions(),
    retry: false,
  });

  return (
    <Page>
      <PageHeader
        title="Networking"
        description="The install-wide edge configuration — every project's routes assembled into the live Caddyfile."
        actions={
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
        }
      />

      {caddyfile.isError ? (
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
      ) : (
        <div className="flex flex-col gap-3">
          <CaddyfileViewer
            source={caddyfile.data?.caddyfile ?? ""}
            revision={caddyfile.data?.revision}
            loading={caddyfile.isLoading}
          />
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>
              Edge defaults (ACME email, HTTPS redirect) are configured in Instance settings.
            </span>
            <Link
              to="/$orgSlug/settings/instance/general"
              params={{ orgSlug }}
              className="inline-flex items-center gap-0.5 text-foreground underline-offset-2 hover:underline"
            >
              Open Instance settings
              <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-3" />
            </Link>
          </div>
        </div>
      )}
    </Page>
  );
}
