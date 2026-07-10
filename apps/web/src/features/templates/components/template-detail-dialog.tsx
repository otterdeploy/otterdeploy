/**
 * Template detail modal: description, an architecture diagram generated from
 * the parsed compose, the included-services and required-env tables, and the
 * "Deploy to project…" footer. Deploy navigates to the chosen project's graph
 * with `?new=template&template=<id>` — the resource-overlay provider picks
 * that up and opens the compose wizard prefilled, so the normal staged
 * manifest flow (review vars → stage → Deploy) takes over from there.
 */
import { useMemo, useState, type ReactNode } from "react";

import { parseCompose } from "@otterdeploy/api/stack/compose/parse";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";

import { SvglLogo } from "@/shared/components/brand/svgl-logo";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { orpc } from "@/shared/server/orpc";

import type { StackTemplate } from "../catalog";

import { TemplateArchDiagram } from "./template-arch-diagram";
import { IncludedServicesTable, RequiredEnvTable } from "./template-detail-sections";

export function TemplateDetailDialog({
  template,
  orgSlug,
  initialProjectSlug,
  onClose,
}: {
  template: StackTemplate | null;
  orgSlug: string;
  initialProjectSlug?: string;
  onClose: () => void;
}) {
  return (
    <Dialog open={template !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[86vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        {template && (
          <TemplateDetailBody
            template={template}
            orgSlug={orgSlug}
            initialProjectSlug={initialProjectSlug}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function TemplateDetailBody({
  template,
  orgSlug,
  initialProjectSlug,
}: {
  template: StackTemplate;
  orgSlug: string;
  initialProjectSlug?: string;
}) {
  // Same parser the wizard preview and the deploy reconciler run — the
  // diagram and tables below can't drift from what would actually deploy.
  const parsed = useMemo(() => parseCompose(template.compose), [template.compose]);

  return (
    <>
      <DialogHeader className="border-b px-5 pt-4 pb-3">
        <div className="flex items-center gap-2.5">
          <SvglLogo search={template.logoBrand} fallback={template.name} size={30} />
          <DialogTitle>{template.name}</DialogTitle>
          <a
            href={template.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-auto text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Docs ↗
          </a>
        </div>
        <DialogDescription className="text-left">{template.description}</DialogDescription>
      </DialogHeader>

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
        {parsed.isOk() ? (
          <>
            <Section title="Architecture">
              <TemplateArchDiagram parsed={parsed.value} />
            </Section>
            <Section title="Included services">
              <IncludedServicesTable parsed={parsed.value} />
            </Section>
          </>
        ) : (
          <p className="rounded-lg bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
            This template's compose file failed to parse: {parsed.error.message}
          </p>
        )}
        <Section title="Required variables">
          <RequiredEnvTable requiredEnv={template.requiredEnv} />
          {template.requiredEnv.length > 0 && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              You'll set these in the compose wizard before anything is staged.
            </p>
          )}
        </Section>
      </div>

      <DeployFooter template={template} orgSlug={orgSlug} initialProjectSlug={initialProjectSlug} />
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[13px] font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function DeployFooter({
  template,
  orgSlug,
  initialProjectSlug,
}: {
  template: StackTemplate;
  orgSlug: string;
  initialProjectSlug?: string;
}) {
  const router = useRouter();
  const { data: projects } = useQuery(orpc.project.list.queryOptions());
  const [picked, setPicked] = useState(initialProjectSlug ?? "");
  // Fall back to the first project once the list loads, without an effect.
  const projectSlug = picked || projects?.[0]?.slug || "";
  const items = (projects ?? []).map((p) => ({ label: p.name, value: p.slug }));

  return (
    <div className="flex items-center gap-2 border-t px-5 py-3.5">
      <span className="text-[11px] text-muted-foreground">
        Stages {template.includes.length} service{template.includes.length === 1 ? "" : "s"} — you
        review and Deploy from the project graph.
      </span>
      <div className="flex-1" />
      {items.length > 0 ? (
        <>
          <Select items={items} value={projectSlug} onValueChange={(v) => setPicked(v ?? "")}>
            <SelectTrigger className="h-8 w-44" aria-label="Deploy to project">
              <SelectValue placeholder="Pick a project" />
            </SelectTrigger>
            <SelectContent>
              {items.map((it) => (
                <SelectItem key={it.value} value={it.value}>
                  {it.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            disabled={!projectSlug}
            onClick={() =>
              // Plain history push so the untyped params survive — they're read
              // from raw location search by the wizard overlay provider.
              router.history.push(
                `/${orgSlug}/${projectSlug}/graph?new=template&template=${template.id}`,
              )
            }
          >
            Deploy to project
          </Button>
        </>
      ) : (
        <span className="text-xs text-muted-foreground">
          {projects ? "No projects yet — create one first." : "Loading projects…"}
        </span>
      )}
    </div>
  );
}
