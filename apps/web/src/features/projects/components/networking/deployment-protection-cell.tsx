import { useState } from "react";

import { ShieldKeyIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";

import {
  ProtectionStateLabel,
  ProtectionSwitch,
} from "@/features/projects/components/networking/protection-switch";
import { RouteAccessDialogContent } from "@/features/projects/components/networking/route-access-dialog";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogTrigger } from "@/shared/components/ui/dialog";

interface ProtectionRoute {
  id: string;
  domain: string;
  protected: boolean;
  isHttp: boolean;
}

/** Matches ProtectionStateLabel's box, so the "–" row sits at the same width. */
const LABEL_WIDTH = "w-[14ch]";

/**
 * Per-route deployment-protection control for the Routes table: a toggle for
 * the auth wall plus a shortcut dialog to manage guest access, a shareable
 * link, and a CI bypass token. Only meaningful for HTTP routes: layer-4
 * (database) routes can't carry a forward_auth gate. The same controls live,
 * always-visible, on the Networking → Access tab.
 *
 * Every branch below lays out to the same width. A cell that changes size when
 * you operate it drags the rows under the pointer, and the column is shared, so
 * one toggle re-flows every other route's cell too.
 */
export function DeploymentProtectionCell({
  route,
  projectId,
}: {
  route: ProtectionRoute;
  projectId: string;
}) {
  if (!route.isHttp) {
    return <span className={`${LABEL_WIDTH} inline-block text-muted-foreground`}>–</span>;
  }

  return (
    <div className="flex items-center gap-2.5">
      <ProtectionStateLabel isProtected={route.protected} />
      <ProtectionSwitch route={route} projectId={projectId} />
      {/* The slot is always here, empty when public: the shortcut only applies
          to a protected route, but letting it appear and vanish would resize
          the column on every toggle. */}
      <span className="flex size-7 shrink-0 items-center justify-center">
        {route.protected ? <AccessDialog routeId={route.id} domain={route.domain} /> : null}
      </span>
    </div>
  );
}

function AccessDialog({ routeId, domain }: { routeId: string; domain: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground"
            aria-label={t("routeAccess.manageAccess")}
            title={t("routeAccess.manageAccess")}
          />
        }
      >
        <HugeiconsIcon icon={ShieldKeyIcon} strokeWidth={1.8} className="size-3.5" />
      </DialogTrigger>
      {/* This shortcut only renders on protected routes, so the wall is on. */}
      <RouteAccessDialogContent routeId={routeId} domain={domain} isProtected />
    </Dialog>
  );
}
