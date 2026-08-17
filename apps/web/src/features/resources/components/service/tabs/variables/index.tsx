// Variables tab body for a service resource. Wraps the shared
// VariablesEditor (originally written for postgres) with a service-
// flavoured header — services don't have engine-exported keys, so this
// is just the user env bag + a search/add header.

import type { ProjectId } from "@otterdeploy/shared/id";

import { useRef, useState } from "react";

import { PlusSignIcon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { useStageManifestChange } from "@/features/projects/hooks/use-manifest-stage";
import { VariableRefHint } from "@/features/resources/components/_shared/hint-banner";
import {
  VariablesEditor,
  type VariablesEditorHandle,
  type VariablesEditorResource,
} from "@/features/resources/components/_shared/variables-editor";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { orpc } from "@/shared/server/orpc";

export function ServiceVariablesTabBody({
  resource,
  pending = false,
  serviceName,
}: {
  resource: VariablesEditorResource;
  // Pending-create mode: no resourceId yet, so saves stage onto the manifest
  // entry (`services[serviceName].env`) instead of hitting the live resource.
  pending?: boolean;
  serviceName?: string;
}) {
  const { onSave, editorResource } = useStagedEnvSave({ resource, pending, serviceName });
  const [hintDismissed, setHintDismissed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const editorRef = useRef<VariablesEditorHandle>(null);
  void query; // search is wired by the editor's own filter once the surface lands

  const varCount = Object.keys(editorResource.extraEnv ?? {}).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-semibold">{varCount} Service Variables</span>
          <button
            type="button"
            onClick={() => setSearchOpen((p) => !p)}
            className="grid size-7 place-items-center rounded text-muted-foreground/70 hover:bg-muted hover:text-foreground"
            aria-label="Search variables"
          >
            <HugeiconsIcon icon={Search01Icon} strokeWidth={2} className="size-3.5" />
          </button>
        </div>
        <Button
          size="sm"
          className="h-8 gap-1.5 text-[12px]"
          onClick={() => editorRef.current?.addRow()}
        >
          <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="size-3.5" />
          New Variable
        </Button>
      </div>

      {searchOpen && (
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by variable name…"
          className="h-9 font-mono text-[12.5px]"
        />
      )}

      {!hintDismissed && (
        <VariableRefHint
          context="service"
          projectId={resource.projectId}
          onPick={(token) => editorRef.current?.insertReference(token)}
          onDismiss={() => setHintDismissed(true)}
        />
      )}

      {/* countLabel null: the tab header above already shows "N Service
          Variables" for the same rows — a second toolbar count read as a
          separate "User Variables" bag and double-counted every var. */}
      <VariablesEditor ref={editorRef} resource={editorResource} onSave={onSave} countLabel={null} />
    </div>
  );
}

/**
 * Saving STAGES onto the manifest whenever the service is declared there —
 * pending creates always are, and live services are once applied. The pill
 * (pending-changes bar) then surfaces the env diff for review; Apply
 * reconciles + redeploys. Direct-write (`env.bulkSet`, takes effect on next
 * redeploy) remains only as the fallback for services the manifest doesn't
 * know — e.g. drifted or pre-manifest resources (onSave undefined → the
 * editor's own bulkSet mutation).
 *
 * Once env is DECLARED on the manifest entry, the staged map is also the
 * saved state the editor should baseline against — the live rows lag it
 * until Apply, and baselining on them would repaint the editor with
 * pre-stage values (with dirty chips) right after a successful save.
 */
function useStagedEnvSave({
  resource,
  pending,
  serviceName,
}: {
  resource: VariablesEditorResource;
  pending: boolean;
  serviceName?: string;
}): {
  onSave: ((env: Array<{ key: string; value: string }>) => Promise<void>) | undefined;
  editorResource: VariablesEditorResource;
} {
  const { t } = useTranslation();
  const stage = useStageManifestChange(resource.projectId, {
    successToast: t("resources.variablesStaged"),
  });
  const manifest = useQuery(
    orpc.project.manifest.get.queryOptions({
      input: { id: resource.projectId },
      enabled: !pending,
    }),
  );
  const manifestEntry = serviceName ? manifest.data?.manifest?.services?.[serviceName] : undefined;
  const staged = Boolean(serviceName && (pending || manifestEntry !== undefined));

  const onSave =
    staged && serviceName
      ? async (env: Array<{ key: string; value: string }>) => {
          await stage.mutateAsync((m) => {
            const svc = m.services[serviceName];
            if (!svc) return m;
            return {
              ...m,
              services: {
                ...m.services,
                [serviceName]: {
                  ...svc,
                  env: Object.fromEntries(env.map((e) => [e.key, e.value])),
                },
              },
            };
          });
        }
      : undefined;

  const declaredEnv = !pending && staged ? manifestEntry?.env : undefined;
  const editorResource =
    declaredEnv !== undefined ? { ...resource, extraEnv: declaredEnv } : resource;
  return { onSave, editorResource };
}
