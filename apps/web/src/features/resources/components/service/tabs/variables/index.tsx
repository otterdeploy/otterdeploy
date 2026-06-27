// Variables tab body for a service resource. Wraps the shared
// VariablesEditor (originally written for postgres) with a service-
// flavoured header — services don't have engine-exported keys, so this
// is just the user env bag + a search/add header.

import type { ProjectId } from "@otterdeploy/shared/id";

import { useState } from "react";

import { PlusSignIcon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { useStageManifestChange } from "@/features/projects/hooks/use-manifest-stage";
import { VariableRefHint } from "@/features/resources/components/_shared/hint-banner";
import {
  VariablesEditor,
  type VariablesEditorResource,
} from "@/features/resources/components/_shared/variables-editor";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";

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
  const stage = useStageManifestChange(resource.projectId as ProjectId, {
    successToast: "Variables staged — Deploy to apply",
  });
  const onSave =
    pending && serviceName
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
  const [hintDismissed, setHintDismissed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [addingSignal, setAddingSignal] = useState(0);
  void query; // search is wired by the editor's own filter once the surface lands

  const varCount = Object.keys(resource.extraEnv ?? {}).length;

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
          onClick={() => setAddingSignal((n) => n + 1)}
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

      {!hintDismissed && <VariableRefHint onDismiss={() => setHintDismissed(true)} />}

      <VariablesEditor resource={resource} addRowSignal={addingSignal} onSave={onSave} />
    </div>
  );
}
