/**
 * LOCAL PREVIEW ONLY — do not ship. Renders the real templates gallery (and its
 * detail dialogs, incl. the Authentik 4-service stack) OUTSIDE the auth-gated
 * `_app` tree, so the deploy screens can be reviewed on the dev server without a
 * backend / login. The catalog is client-side, so this is the real UI, not a
 * mock. Delete this file before committing.
 */
import { createFileRoute } from "@tanstack/react-router";

import { TemplatesGallery } from "@/features/templates/components/templates-gallery";

export const Route = createFileRoute("/preview")({
  component: () => (
    <div className="min-h-svh bg-background text-foreground">
      <TemplatesGallery orgSlug="preview" />
    </div>
  ),
});
