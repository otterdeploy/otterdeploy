import { useState } from "react";
import { createFileRoute, Link, useLoaderData } from "@tanstack/react-router";

import {
  NewResourceKindDialog,
  NewResourceOverlayDialog,
} from "@/features/projects/components/new-resource/new-resource-dialogs";
import { ID_PREFIX, type Slug } from "@otterstack/shared/id";

export const Route = createFileRoute("/_app/$orgSlug/$projectSlug/")({
  staticData: { crumb: "Overview" },
  component: RouteComponent,
});

function RouteComponent() {
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  const { project } = useLoaderData({ from: "/_app/$orgSlug/$projectSlug" });

  const [kindDialogOpen, setKindDialogOpen] = useState(false);
  const [overlayDialogOpen, setOverlayDialogOpen] = useState(false);

  const orgSlug = organization.slug;
  const projectSlug = project.slug as Slug<typeof ID_PREFIX.project>;

  const triggerClass =
    "inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent";

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold">{project.name}</h1>
      <p className="text-muted-foreground">Project overview / control plane.</p>

      <Link
        params={{ orgSlug, projectSlug }}
        to="/$orgSlug/$projectSlug/graph"
      >
        <button>Go to {project.name}</button>
      </Link>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          params={{ orgSlug, projectSlug }}
          to="/$orgSlug/$projectSlug/new-resource"
          className={triggerClass}
        >
          + Add resource
        </Link>
        <button
          type="button"
          onClick={() => setKindDialogOpen(true)}
          className={triggerClass}
        >
          + Add (dialog)
        </button>
        <button
          type="button"
          onClick={() => setOverlayDialogOpen(true)}
          className={triggerClass}
        >
          + Add (overlay)
        </button>
      </div>

      <NewResourceKindDialog
        orgSlug={orgSlug}
        projectSlug={projectSlug}
        open={kindDialogOpen}
        onOpenChange={setKindDialogOpen}
      />
      <NewResourceOverlayDialog
        orgSlug={orgSlug}
        projectSlug={projectSlug}
        projectName={project.name}
        open={overlayDialogOpen}
        onOpenChange={setOverlayDialogOpen}
      />
    </div>
  );
}
