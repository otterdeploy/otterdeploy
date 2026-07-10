import { useEffect, useState, type ReactNode } from "react";

import { useLocation, useMatch, useParams } from "@tanstack/react-router";

import { getTemplateById } from "@/features/templates/catalog";

import type { ComposePrefill } from "./compose-wizard-shared";
import type { OverlayContextValue } from "./overlay-context";

import { ResourceOverlayDialog } from "./new-resource-dialogs";
import { ResourceOverlayContext, useResourceOverlay } from "./overlay-context";

// Existing consumers (site header, command palette) import the hook from
// here; the implementation moved to ./overlay-context to avoid a cycle.
export { useResourceOverlay };

/** Drop the wizard-open params from the address bar once consumed, so a
 *  refresh doesn't re-open the dialog. Plain history API on purpose — the
 *  params are untyped and shared across every project route. */
function stripWizardParams() {
  const url = new URL(window.location.href);
  url.searchParams.delete("new");
  url.searchParams.delete("template");
  window.history.replaceState({}, "", url);
}

export function ResourceOverlayProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  // Template handoff from the gallery (`?new=template&template=<id>`): when
  // set, the dialog opens straight on the compose flow seeded with the
  // template. Cleared when the dialog closes so the next open is a fresh pick.
  const [composePrefill, setComposePrefill] = useState<ComposePrefill | null>(null);
  const { orgSlug, projectSlug } = useParams({ strict: false });
  // Pull the loaded project so the wizard has its id (the create mutation
  // takes projectId, not projectSlug). Only resolves when we're below
  // /_app/$orgSlug/$projectSlug — otherwise the dialog wouldn't render anyway.
  const projectMatch = useMatch({
    from: "/_app/$orgSlug/$projectSlug",
    shouldThrow: false,
  });
  const project = projectMatch?.loaderData?.project;

  // `?new=service` reopens the wizard — the GitHub connect round-trip uses it
  // as its returnTo target since dialog state can't survive leaving the app.
  // Strip the param once consumed so a refresh doesn't re-open.
  const wantsWizard =
    useLocation({ select: (l) => (l.search as { new?: string }).new }) === "service";
  useEffect(() => {
    if (!wantsWizard || !project) return;
    setOpen(true);
    stripWizardParams();
  }, [wantsWizard, project]);

  // `?new=template&template=<id>` — the templates gallery's "Deploy to
  // project…" target. Look the template up in the typed catalog and open the
  // wizard prefilled; unknown ids just strip (no dialog, nothing invented).
  const templateId = useLocation({
    select: (l) => {
      const s = l.search as { new?: string; template?: string };
      return s.new === "template" ? (s.template ?? null) : null;
    },
  });
  useEffect(() => {
    if (!templateId || !project) return;
    const template = getTemplateById(templateId);
    if (template) {
      setComposePrefill({ name: template.name, content: template.compose });
      setOpen(true);
    }
    stripWizardParams();
  }, [templateId, project]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setComposePrefill(null);
  };

  const value: OverlayContextValue = {
    open,
    setOpen: handleOpenChange,
    toggle: () => {
      if (open) handleOpenChange(false);
      else setOpen(true);
    },
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
          composePrefill={composePrefill}
          onOpenChange={handleOpenChange}
        />
      )}
    </ResourceOverlayContext.Provider>
  );
}
