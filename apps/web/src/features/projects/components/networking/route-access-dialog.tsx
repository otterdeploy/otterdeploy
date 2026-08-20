/**
 * Access controls for one route, in a dialog.
 *
 * These four sections (guests, PIN, share link, bypass token) are a full
 * editing surface. Inlined in a table row they ran ~700px tall and clipped
 * their own copy at the column edge. A dialog is the same affordance the route
 * policy editor already uses from this table, so the row stays scannable and
 * the controls get the width they were designed for.
 *
 * `RouteAccessDialogContent` is the single shell for this surface: the
 * Routes-table protection cell and the "Manage access" button both render it,
 * so the title, description, and width can never drift apart again.
 */

import { useState } from "react";

import { ShieldKeyIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";

import { RouteAccessControls } from "@/features/projects/components/networking/route-access-controls";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";

/** The one dialog shell for a route's access surface. The domain is a
 *  machine string, so it renders in mono; the title stays short so long
 *  sslip.io hosts never wrap the header. */
export function RouteAccessDialogContent({
  routeId,
  domain,
  isProtected,
}: {
  routeId: string;
  domain: string;
  isProtected: boolean;
}) {
  const { t } = useTranslation();
  return (
    <DialogContent className="sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>{t("routeAccess.title")}</DialogTitle>
        <DialogDescription>
          {/* The domain is a standalone token rather than a word inside the
              sentence, so translations never have to bend around it. */}
          <span className="font-mono text-[12.5px]">{domain}</span>
          {" — "}
          {isProtected ? t("routeAccess.wallOn") : t("routeAccess.wallOff")}
        </DialogDescription>
      </DialogHeader>
      <div className="max-h-[70vh] overflow-y-auto pt-1 pr-1">
        <RouteAccessControls routeId={routeId} />
      </div>
    </DialogContent>
  );
}

export function RouteAccessButton({
  routeId,
  domain,
  isProtected,
}: {
  routeId: string;
  domain: string;
  isProtected: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <HugeiconsIcon icon={ShieldKeyIcon} strokeWidth={2} className="size-3.5" />
        {t("routeAccess.manageAccess")}
      </Button>

      <RouteAccessDialogContent routeId={routeId} domain={domain} isProtected={isProtected} />
    </Dialog>
  );
}
