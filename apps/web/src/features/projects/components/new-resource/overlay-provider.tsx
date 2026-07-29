import { useState, type ReactNode } from "react";

import { useLocation, useMatch, useNavigate, useParams } from "@tanstack/react-router";

import { getTemplateById } from "@/features/templates/catalog";

import type { OverlayContextValue } from "./overlay-context";

import { ResourceOverlayDialog } from "./new-resource-dialogs";
import { ResourceOverlayContext, useResourceOverlay } from "./overlay-context";

export function ResourceOverlayProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { orgSlug, projectSlug } = useParams({ strict: false });

  const projectMatch = useMatch({
    from: "/_app/$orgSlug/_shell/$projectSlug",
    shouldThrow: false,
  });
  const project = projectMatch?.loaderData?.project;

  // The two URL handoffs into this wizard, reduced to one primitive so the
  // router subscription compares cheaply (a selected object would be a fresh
  // reference every location read):
  //   `?new=service`              → "service". The GitHub connect round-trip
  //     uses it as its returnTo target, since dialog state can't survive
  //     leaving the app.
  //   `?new=template&template=id` → "template:id". The templates gallery's
  //     "Deploy to project…" target.
  const handoff = useLocation({
    select: (l) => {
      const s = l.search;
      if (s.new === "service") return "service";
      if (s.new === "template") return `template:${s.template ?? ""}`;
      return "";
    },
  });

  // Both the handoff's openness and its prefill are DERIVED from the address
  // bar — no effect mirrors one into state. The params are consumed on close
  // (below) rather than on open, which is what makes that possible: strip them
  // the moment the dialog opens and the derived `open` would flip straight back
  // to false. Unknown template ids read as no handoff (nothing invented).
  const template = handoff.startsWith("template:")
    ? getTemplateById(handoff.slice("template:".length))
    : null;
  const fromUrl = handoff === "service" || template != null;

  // In-app opens (site header, command palette) have no URL to derive from.
  const [openedInApp, setOpenedInApp] = useState(false);
  const open = openedInApp || fromUrl;

  const setOpen = (next: boolean) => {
    setOpenedInApp(next);
    // Closing is what consumes the handoff. `replace` so Back doesn't land on
    // a URL that immediately re-opens the wizard.
    if (!next && handoff) {
      void navigate({
        to: ".",
        search: (prev) => ({ ...prev, new: undefined, template: undefined }),
        replace: true,
      });
    }
  };

  const value: OverlayContextValue = {
    open,
    setOpen,
    toggle: () => setOpen(!open),
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
          composePrefill={
            template
              ? { name: template.name, content: template.compose, logoBrand: template.logoBrand }
              : null
          }
          onOpenChange={setOpen}
        />
      )}
    </ResourceOverlayContext.Provider>
  );
}

// Existing consumers (site header, command palette) import the hook from
// here; the implementation moved to ./overlay-context to avoid a cycle.
export { useResourceOverlay };
