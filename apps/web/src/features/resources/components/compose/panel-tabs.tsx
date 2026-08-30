/**
 * Content tabs for {@link ComposeResourcePanel}: the Compose file viewer /
 * editor and the Settings (exposed-services summary + delete) pane. The member
 * list lives on the Overview tab (see stack-overview-tab.tsx). Pulled into a sibling module so the panel component stays
 * small.
 */

import type { ProjectSlug } from "@otterdeploy/shared/id";

import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";

import {
  ComposeFileEditor,
  ComposeViewer,
} from "@/features/resources/components/compose/compose-yaml-editor";
import { ComposeExposedSummary } from "@/features/resources/components/compose/exposed-summary";
import { TypedConfirmDialog } from "@/shared/components/typed-confirm-dialog";
import { Button } from "@/shared/components/ui/button";

export function ComposeFileTab({
  projectId,
  resourceId,
  source,
  isLoading,
  composeContent,
}: {
  projectId: string;
  resourceId: string;
  source: "inline" | "git";
  isLoading: boolean;
  composeContent: string | null | undefined;
}) {
  const { t } = useTranslation();
  // Git stacks stay read-only. Their compose file lives in the repo and is
  // resolved at build time, so editing it here would just be overwritten.
  if (source === "git") {
    return (
      <>
        <p className="mb-3 rounded-md border border-info/30 bg-info/5 px-3 py-2 text-[12px] text-muted-foreground">
          {t("resources.stackFromRepo")}
        </p>
        {isLoading ? (
          <div className="rounded-lg border bg-card px-4 py-6 text-center text-[12px] text-muted-foreground">
            {t("resources.composeLoading")}
          </div>
        ) : composeContent ? (
          <ComposeViewer content={composeContent} />
        ) : (
          <p className="text-[12.5px] text-muted-foreground">{t("resources.composeEmpty")}</p>
        )}
      </>
    );
  }

  if (isLoading) {
    return (
      <div className="rounded-lg border bg-card px-4 py-6 text-center text-[12px] text-muted-foreground">
        {t("resources.composeLoading")}
      </div>
    );
  }
  if (composeContent == null) {
    return <p className="text-[12.5px] text-muted-foreground">{t("resources.composeEmpty")}</p>;
  }
  // Mounts only once the content has loaded, so the editor seeds its draft from
  // the real YAML without an effect.
  return (
    <ComposeFileEditor
      projectId={projectId}
      resourceId={resourceId}
      initialContent={composeContent}
    />
  );
}

export function ComposeSettingsTab({
  projectId,
  resourceId,
  orgSlug,
  projectSlug,
  name,
  serviceCount,
  onDelete,
  deleting,
}: {
  projectId: string;
  resourceId: string;
  orgSlug: string;
  projectSlug: ProjectSlug;
  name: string;
  serviceCount: number;
  onDelete: () => void;
  deleting: boolean;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="mb-4">
        <ComposeExposedSummary
          projectId={projectId}
          resourceId={resourceId}
          orgSlug={orgSlug}
          projectSlug={projectSlug}
        />
      </div>
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
        <div className="text-[13px] font-semibold text-destructive">
          {t("resources.deleteStack")}
        </div>
        <p className="mt-1 text-[12px] text-muted-foreground">{t("resources.deleteStackBlurb")}</p>
        <TypedConfirmDialog
          trigger={
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="mt-3"
              disabled={deleting}
            >
              <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-3.5" />
              {deleting ? t("common.deleting") : t("resources.deleteStack")}
            </Button>
          }
          title={t("resources.deleteStackTitle", { name })}
          description={t("resources.deleteStackDescription", { n: serviceCount })}
          confirmPhrase={name}
          confirmLabel={t("resources.deleteStack")}
          pendingLabel={t("common.deleting")}
          pending={deleting}
          onConfirm={onDelete}
        />
      </div>
    </>
  );
}
