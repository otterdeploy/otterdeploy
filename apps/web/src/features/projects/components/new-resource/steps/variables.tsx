import { useEffect, useRef } from "react";

import { Alert01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useStore } from "@tanstack/react-form";
import { skipToken, useQuery } from "@tanstack/react-query";

import type { ServiceKind } from "@/features/projects/data/service-kinds";

import { orpc } from "@/shared/server/orpc";

import type { Var } from "../form-fields/variables-field";

import { useFormContext } from "../form-context";
import { SectionHeader } from "../form-primitives";

interface StepVariablesProps {
  kind: ServiceKind | null;
  projectId: string;
}

// Keys that look like credentials get the secret lock on by default.
const SECRETISH =
  /(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|API_?KEY|ACCESS_?KEY|CREDENTIAL|DSN|AUTH|SALT|WEBHOOK|SIGNING)/i;

export function StepVariables({ projectId }: StepVariablesProps) {
  const form = useFormContext();
  const repo = useStore(form.store, (s) => s.values.repo as string);
  const root = useStore(form.store, (s) => s.values.root as string);
  const variables = useStore(form.store, (s) => s.values.variables as Var[]);

  const env = useQuery({
    ...orpc.git.inspectEnv.queryOptions({
      input: repo ? { gitRepoId: repo, path: root || "" } : skipToken,
    }),
    staleTime: 5 * 60 * 1000,
  });

  // Prefill from the repo's .env.example exactly once, and only when the
  // operator hasn't already entered variables — never clobber manual edits.
  const keys = env.data?.keys;
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current) return;
    if (!keys || keys.length === 0) return;
    prefilled.current = true;
    if (variables.length > 0) return;
    form.setFieldValue(
      "variables",
      keys.map((k) => ({ key: k, value: "", secret: SECRETISH.test(k) })),
    );
  }, [keys, variables.length, form]);

  return (
    <>
      <SectionHeader
        title="Environment variables"
        sub="Add key/value pairs — toggle the lock to mark a value as secret. Type ${{ to reference another resource's variables (e.g. a database URL)."
      />

      {env.data?.committedEnv && <CommittedEnvBanner file={env.data.committedEnv} />}

      {env.data?.templateFile && (keys?.length ?? 0) > 0 && (
        <div className="mb-2 rounded-md border border-info/30 bg-info/5 px-3 py-2 text-[12px] text-muted-foreground">
          Pre-filled <span className="font-medium text-foreground">{keys?.length}</span> key
          {keys?.length === 1 ? "" : "s"} from{" "}
          <span className="font-mono">{env.data.templateFile}</span> — add the values.
          Secret-looking keys are locked by default.
        </div>
      )}

      <form.AppField name="variables">
        {(f) => <f.VariablesField projectId={projectId} />}
      </form.AppField>
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
          A real env file is checked into git — anyone with repo access (and the full history) can
          read its secrets. Remove it with <span className="font-mono">git rm --cached {file}</span>
          , add it to <span className="font-mono">.gitignore</span>, and rotate any exposed
          credentials. Don't paste those values here as-is.
        </p>
      </div>
    </div>
  );
}
