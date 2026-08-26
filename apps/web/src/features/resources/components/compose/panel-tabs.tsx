/**
 * Content tabs for {@link ComposeResourcePanel}: the Services list, the
 * read-only Compose file viewer, and the Settings (exposed-services summary +
 * delete) pane. Pulled into a sibling module so the panel component stays
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
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/components/ui/empty";
import { cn } from "@/shared/lib/utils";

import type { ComposeService, StackServiceStatus } from "./panel-parts";

const stackStatusMeta: Record<StackServiceStatus, { label: string; dot: string; text: string }> = {
  running: { label: "Running", dot: "bg-success", text: "text-success" },
  building: { label: "Building", dot: "bg-warning", text: "text-warning" },
  deploying: { label: "Deploying", dot: "bg-info", text: "text-info" },
  error: { label: "Failed", dot: "bg-destructive", text: "text-destructive" },
  offline: {
    label: "Offline",
    dot: "bg-muted-foreground/40",
    text: "text-muted-foreground",
  },
  pending: { label: "Pending", dot: "bg-info", text: "text-info" },
};

export function ComposeServicesTab({
  services,
  source,
  serviceStatus,
}: {
  services: ComposeService[];
  source: "inline" | "git";
  serviceStatus: (serviceName: string) => StackServiceStatus;
}) {
  const { t } = useTranslation();
  if (services.length === 0) {
    return (
      <Empty className="rounded-md border border-dashed bg-muted/20 py-12">
        <EmptyHeader>
          <EmptyTitle>{t("resources.stackNoServices")}</EmptyTitle>
          <EmptyDescription>
            {source === "git"
              ? t("resources.stackNoServicesGit")
              : t("resources.stackNoServicesInline")}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    // One column normally; two once the pane is wide enough that a single
    // column of ~90px cards would be a stripe of whitespace. Container
    // queries, not viewport ones: what matters is how wide the PANE is, which
    // depends on the drawer's expanded state, not on the window.
    <div className="@container">
      <div className="grid grid-cols-1 gap-2.5 @3xl:grid-cols-2">
        {services.map((s) => (
          <ServiceRow key={s.name} service={s} status={serviceStatus(s.serviceName)} />
        ))}
      </div>
    </div>
  );
}

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

function ServiceRow({ service, status }: { service: ComposeService; status: StackServiceStatus }) {
  const meta = stackStatusMeta[status];
  // Task-derived "building" covers swarm's pre-running phases (pulling,
  // starting): for an image-only service nothing builds, so say "Deploying".
  const label =
    status === "error" && service.hasBuild
      ? "Build failed"
      : status === "building" && !service.hasBuild
        ? "Deploying"
        : meta.label;
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-[14px] font-semibold text-card-foreground">
          {service.name}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1.5">
          <span className={cn("size-1.5 rounded-full", meta.dot)} aria-hidden />
          <span className={cn("text-[12px] leading-none", meta.text)}>{label}</span>
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11.5px] text-muted-foreground">
        <span className="truncate">
          {service.image ?? (service.hasBuild ? "built from source" : "–")}
        </span>
        {service.ports.length > 0 && <span>· ports {service.ports.join(", ")}</span>}
      </div>
      {service.volumes.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {service.volumes.map((v) => (
            <span
              key={v}
              className="rounded-md bg-muted/60 px-1.5 py-1 font-mono text-[11px] leading-none text-muted-foreground"
            >
              {v}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
