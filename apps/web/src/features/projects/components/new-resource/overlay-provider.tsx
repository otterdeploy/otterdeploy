import { createContext, useContext, useState, type ReactNode } from "react";

import { useMatch, useParams } from "@tanstack/react-router";

import { ResourceOverlayDialog } from "./new-resource-dialogs";

interface OverlayContextValue {
  open: boolean;
  setOpen: (next: boolean) => void;
  toggle: () => void;
}

const ResourceOverlayContext = createContext<OverlayContextValue | null>(null);

export function ResourceOverlayProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { orgSlug, projectSlug } = useParams({ strict: false });
  // Pull the loaded project so the wizard has its id (the create mutation
  // takes projectId, not projectSlug). Only resolves when we're below
  // /_app/$orgSlug/$projectSlug — otherwise the dialog wouldn't render anyway.
  const projectMatch = useMatch({
    from: "/_app/$orgSlug/$projectSlug",
    shouldThrow: false,
  });
  const project = projectMatch?.loaderData?.project;

  const value: OverlayContextValue = {
    open,
    setOpen,
    toggle: () => setOpen((p) => !p),
  };

  return (
    <ResourceOverlayContext.Provider value={value}>
      {children}
      {orgSlug && projectSlug && project && (
        <ResourceOverlayDialog
          orgSlug={orgSlug}
          projectSlug={projectSlug}
          projectId={project.id}
          projectName={project.name}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </ResourceOverlayContext.Provider>
  );
}

export function useResourceOverlay(): OverlayContextValue {
  const ctx = useContext(ResourceOverlayContext);
  if (!ctx) {
    throw new Error("useResourceOverlay must be used inside <ResourceOverlayProvider>");
  }
  return ctx;
}
