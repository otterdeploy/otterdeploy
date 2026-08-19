import { Alert01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useSelector } from "@tanstack/react-form";
import { skipToken, useQuery } from "@tanstack/react-query";

import type { ServiceKind } from "@/features/projects/data/service-kinds";

import { envSuggestionsForImage } from "@/features/resources/env-catalog";
import { orpc } from "@/shared/server/orpc";

import { useFormContext } from "../form-context";
import { LinkedSecretsField } from "../form-fields/linked-secrets-field";
import { noDuplicateKeysValidator } from "../form-fields/variables-field";
import { SectionHeader } from "../form-primitives";

interface StepVariablesProps {
  kind: ServiceKind | null;
  projectId: string;
}

/**
 * Read-only here: filling the rows from `.env.example` is `applyVariables` in
 * `source-defaults`, which runs when the repo or root is bound. This step only
 * reports what that probe found (the committed-env warning and the count)
 * and reads it straight out of the cache the probe already populated.
 */
export function StepVariables({ projectId }: StepVariablesProps) {
  const form = useFormContext();
  const repo = useSelector(form.store, (s) => s.values.repo);
  const root = useSelector(form.store, (s) => s.values.root);
  // Docker-image services: the typed image keys the env-catalog autocomplete.
  // Git-sourced services have no image yet, so this stays empty for them.
  const image = useSelector(form.store, (s) => s.values.image);
  const suggestions = envSuggestionsForImage(image);

  const env = useQuery({
    ...orpc.git.inspectEnv.queryOptions({
      input: repo ? { gitRepoId: repo, path: root || "" } : skipToken,
    }),
    staleTime: 5 * 60 * 1000,
  });
  const keys = env.data?.keys;

  return (
    <>
      <SectionHeader
        title="Environment variables"
        sub="Add key/value pairs. Toggle the lock to mark a value as secret. Type ${{ to reference another resource's variables (e.g. a database URL)."
      />

      {env.data?.committedEnv && <CommittedEnvBanner file={env.data.committedEnv} />}

      {env.data?.templateFile && (keys?.length ?? 0) > 0 && (
        <div className="mb-2 rounded-md border border-info/30 bg-info/5 px-3 py-2 text-[12px] text-muted-foreground">
          Pre-filled <span className="font-medium text-foreground">{keys?.length}</span> key
          {keys?.length === 1 ? "" : "s"} from{" "}
          <span className="font-mono">{env.data.templateFile}</span>. Add the values. Secret-looking
          keys are locked by default.
        </div>
      )}

      <form.AppField name="variables" validators={{ onChange: noDuplicateKeysValidator }}>
        {(f) => <f.VariablesField projectId={projectId} suggestions={suggestions} />}
      </form.AppField>

      {/* External secret-manager hint: `${{vault.…}}` refs work in the value
          cells above; this only points at the capability (or its settings
          page when no provider is connected yet). */}
      <div className="mt-2">
        <LinkedSecretsField />
      </div>
    </>
  );
}

/**
 * A committed real env file means secrets are sitting in git history for
 * anyone with repo access. Loud, destructive banner with remediation steps.
 */
function CommittedEnvBanner({ file }: { file: string }) {
  return (
    <div className="mb-3 flex items-start gap-2.5 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-[12.5px]">
      <HugeiconsIcon
        icon={Alert01Icon}
        strokeWidth={2}
        className="mt-0.5 size-4 shrink-0 text-destructive"
      />
      <div className="min-w-0">
        <div className="font-semibold text-destructive">
          Security risk: <span className="font-mono">{file}</span> is committed to the repo
        </div>
        <p className="mt-0.5 text-muted-foreground">
          A real env file is checked into git, so anyone with repo access (and the full history) can
          read its secrets. Remove it with <span className="font-mono">git rm --cached {file}</span>
          , add it to <span className="font-mono">.gitignore</span>, and rotate any exposed
          credentials. Don't paste those values here as-is.
        </p>
      </div>
    </div>
  );
}
