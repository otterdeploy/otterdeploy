import { useParams } from "@tanstack/react-router";
import { createContext, useContext, useState, type ReactNode } from "react";

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

  const value: OverlayContextValue = {
    open,
    setOpen,
    toggle: () => setOpen((p) => !p),
  };

  return (
    <ResourceOverlayContext.Provider value={value}>
      {children}
      {orgSlug && projectSlug && (
        <ResourceOverlayDialog
          orgSlug={orgSlug}
          projectSlug={projectSlug}
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
