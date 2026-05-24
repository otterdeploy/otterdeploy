import { createContext, useContext, useState, type ReactNode } from "react";
import { useParams } from "@tanstack/react-router";

import { NewResourceOverlayDialog } from "./new-resource-dialogs";
import { ID_PREFIX, type Slug } from "@otterstack/shared/id";

type OverlayContextValue = {
  open: boolean;
  setOpen: (next: boolean) => void;
  toggle: () => void;
};

const NewResourceOverlayContext = createContext<OverlayContextValue | null>(null);

export function NewResourceOverlayProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { orgSlug, projectSlug } = useParams({ strict: false });

  const value: OverlayContextValue = {
    open,
    setOpen,
    toggle: () => setOpen((p) => !p),
  };

  return (
    <NewResourceOverlayContext.Provider value={value}>
      {children}
      {orgSlug && projectSlug && (
        <NewResourceOverlayDialog
          orgSlug={orgSlug}
          projectSlug={projectSlug as Slug<typeof ID_PREFIX.project>}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </NewResourceOverlayContext.Provider>
  );
}

export function useNewResourceOverlay(): OverlayContextValue {
  const ctx = useContext(NewResourceOverlayContext);
  if (!ctx) {
    throw new Error(
      "useNewResourceOverlay must be used inside <NewResourceOverlayProvider>",
    );
  }
  return ctx;
}
