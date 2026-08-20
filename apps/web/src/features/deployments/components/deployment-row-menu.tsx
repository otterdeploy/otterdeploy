/**
 * The ⋯ menu on a project-deployments row: the non-destructive actions that
 * don't earn an inline icon. Open detail / view logs / copy sha. Cancel and
 * roll back stay inline in the row (deployment-row.tsx) because they're the
 * actions an operator reaches for under pressure.
 */

import { MoreHorizontalCircle01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { copyToClipboard } from "@/shared/lib/clipboard";

import type { ProjectDeployment } from "../data/deployments-search";

/** The row's copyable provenance, in preference order: commit sha, source
 *  tarball hash, image ref. Every deploy has at least the image. */
function provenanceRef(d: ProjectDeployment): string {
  return d.gitSha ?? d.sourceSha ?? d.image;
}

export function DeploymentRowMenu({
  d,
  onOpen,
  onViewLogs,
}: {
  d: ProjectDeployment;
  onOpen: (d: ProjectDeployment) => void;
  onViewLogs: (d: ProjectDeployment) => void;
}) {
  const { t } = useTranslation();

  const copyRef = () => {
    const ref = provenanceRef(d);
    void copyToClipboard(ref).then((ok) =>
      ok ? toast.success(`Copied ${ref.slice(0, 24)}`) : toast.error("Couldn't copy"),
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-7 opacity-70 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            title={t("deployments.moreActions")}
            aria-label={t("deployments.moreActions")}
          >
            <HugeiconsIcon icon={MoreHorizontalCircle01Icon} strokeWidth={2} className="size-3.5" />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onOpen(d)}>{t("deployments.openDetail")}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onViewLogs(d)}>
          {t("deployments.viewLogs")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={copyRef}>{t("deployments.copySha")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
