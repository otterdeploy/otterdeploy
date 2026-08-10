/**
 * The presentational halves of the Review step: the summary card, the
 * what-happens-on-apply note, and the generated compose.yml pane. Split out of
 * review.tsx so that file is a thin subscribe-and-lay-out shell. Each part
 * here answers one question the operator asks before staging, and each carries
 * its own conditional wording (db vs service, public vs internal).
 */

import type { ServiceKind } from "@/features/projects/data/service-kinds";

import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import { copyToClipboard } from "@/shared/lib/clipboard";

import type { ReviewModel } from "./review-model";

import { I } from "../icons";

function ReviewRow({ label, value, last }: { label: string; value?: string; last?: boolean }) {
  if (!value) return null;
  return (
    <div
      className={`flex items-start px-3 py-2 text-xs ${last ? "" : "border-b border-border/60"}`}
    >
      <span className="w-24 shrink-0 pt-0.5 text-[11px] text-muted-foreground">{label}</span>
      <span className="flex-1 font-mono wrap-break-word text-foreground">{value}</span>
    </div>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 text-[10px] tracking-wider text-muted-foreground uppercase">
      {children}
    </div>
  );
}

/** How the Access row reads. Its own helper because a database is "exposed"
 *  while a service is only public through named hostnames, and naming the
 *  three outcomes beats a nested ternary in the middle of the card. */
function accessValue(model: ReviewModel): string {
  if (!model.isPublic) return "Internal only";
  if (model.isDb) return "Public (exposed)";
  return `Public: ${model.serviceDomains.join(", ")}`;
}

/** Everything that will be staged, as rows. */
export function ReviewSummaryCard({ kind, model }: { kind: ServiceKind; model: ReviewModel }) {
  const { name, version, cpu, mem, isDb, isPg, replicas, extensions } = model;
  return (
    <Card className="gap-0 overflow-hidden rounded-md p-0">
      <ReviewRow label="Type" value={kind.name} />
      <ReviewRow label="Name" value={name} />
      {isDb && version && <ReviewRow label="Version" value={`${kind.id} ${version}`} />}
      <ReviewRow
        label="Resources"
        value={`${cpu} vCPU · ${mem >= 1024 ? mem / 1024 + " GB" : mem + " MB"} per replica`}
      />
      {isDb && model.mountTarget && (
        // Honest storage summary: a plain named volume with no
        // sizing/backup policy: backups are scheduled post-deploy.
        <ReviewRow label="Storage" value={`named volume · ${model.mountTarget}`} />
      )}
      {isPg && extensions.length > 0 && (
        <ReviewRow label="Extensions" value={model.extensionLabels} />
      )}
      {!isDb && <ReviewRow label="Replicas" value={`${replicas}`} />}
      <ReviewRow label="Access" value={accessValue(model)} />
      <ReviewRow label="Network" value={`${name}.internal`} last />
    </Card>
  );
}

/** The work `apply` will do, in one sentence. Registry pulls don't build or
 *  push anything (the exact ref from the Image step is pulled and run) so
 *  the wording (and the rough timing) differ per kind. */
export function ApplyNote({ kind, model }: { kind: ServiceKind; model: ReviewModel }) {
  const { isDb, replicas } = model;
  const plural = replicas > 1 ? "s" : "";
  const deployPhrase = `deploy ${replicas} replica${plural} via Docker Swarm`;
  const work = isDb
    ? "pull the image, provision a volume, and start the database"
    : kind.id === "docker"
      ? `pull the image and ${deployPhrase}`
      : `build the image from source and ${deployPhrase}`;
  const seconds = isDb || kind.id === "docker" ? "45" : "90";
  return (
    <Card className="mt-3.5 gap-0 rounded-md bg-muted p-3">
      <div className="flex items-start gap-2">
        <I.bolt width={14} height={14} className="mt-0.5 shrink-0 text-muted-foreground" />
        <p className="text-xs leading-relaxed text-muted-foreground">
          On apply, Otterdeploy will {work}, register internal DNS, and wire it onto the internal
          network, usually about {seconds} seconds.
        </p>
      </div>
    </Card>
  );
}

/** The generated compose.yml, copyable. */
export function ComposePreview({ compose }: { compose: string }) {
  return (
    <>
      <pre className="m-0 max-h-120 overflow-auto rounded-md border bg-muted p-3.5 font-mono text-[11.5px] leading-relaxed whitespace-pre text-muted-foreground">
        {compose}
      </pre>
      <div className="mt-2 flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={() => void copyToClipboard(compose)}
        >
          <I.copy width={11} height={11} />
          Copy
        </Button>
        {/* "Save as preset" removed. There is no preset store; a
            button that saves nothing is a fake control. */}
        <div className="flex-1" />
        <span className="self-center font-mono text-[11px] text-muted-foreground">
          otterdeploy apply
        </span>
      </div>
    </>
  );
}
