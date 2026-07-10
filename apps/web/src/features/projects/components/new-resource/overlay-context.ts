/**
 * Context for the provider-owned resource wizard dialog. Split from
 * overlay-provider.tsx so components rendered INSIDE the dialog (e.g. the
 * kind picker, which closes the overlay when routing to the templates
 * gallery) can consume the context without importing the provider module —
 * that would be a cycle: provider → dialog → wizard → steps → kind-picker.
 */
import { createContext, useContext } from "react";

export interface OverlayContextValue {
  open: boolean;
  setOpen: (next: boolean) => void;
  toggle: () => void;
}

export const ResourceOverlayContext = createContext<OverlayContextValue | null>(null);

export function useResourceOverlay(): OverlayContextValue {
  const ctx = useContext(ResourceOverlayContext);
  if (!ctx) {
    throw new Error("useResourceOverlay must be used inside <ResourceOverlayProvider>");
  }
  return ctx;
}
