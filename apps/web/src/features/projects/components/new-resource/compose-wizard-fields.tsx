/**
 * Source-specific field groups for the Compose wizard: the git-source inputs,
 * and the inline group that orders the parsed services above the file. Split
 * out of compose-wizard.tsx to keep that file under the line caps. The file
 * itself (editor, disclosure, supporting files) lives in ./compose-file-panel
 * and the optional stack-name field in ./compose-name-field.
 *
 * Each group derives its own placeholder name from what it already has (git:
 * the repo URL; inline: the parsed `name:`).
 */

import type { ProjectId, ProjectSlug } from "@otterdeploy/shared/id";
import type { ReactCodeMirrorRef } from "@uiw/react-codemirror";

import { useId, useMemo } from "react";

import { useSelector } from "@tanstack/react-form";
import { useTranslation } from "react-i18next";

import { Input } from "@/shared/components/ui/input";

import type { ComposeForm, Preview } from "./compose-wizard-shared";

import { ComposeFileField } from "./compose-detect";
import { ComposeFilePanel } from "./compose-file-panel";
import { ComposeNameField } from "./compose-name-field";
import { ComposePreview } from "./compose-preview";
import { stackNamePlaceholder } from "./compose-schema";
import { RepoPicker } from "./steps/repo-picker";
import { useBindingSummary } from "./steps/source-binding";
import { BranchPicker } from "./steps/source-pickers";

/** "Paste file" / "From repo". Rendered only when no template prefilled the
 *  content: a template IS the source, so switching away only discards it. */
export function ComposeSourceToggle({
  source,
  onSelect,
}: {
  source: "inline" | "git";
  onSelect: (s: "inline" | "git") => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="inline-flex w-fit items-center gap-1 rounded-md border bg-muted/40 p-0.5">
      {(["inline", "git"] as const).map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onSelect(s)}
          className={
            source === s
              ? "rounded bg-background px-2.5 py-1 text-xs text-foreground shadow-sm"
              : "rounded px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
          }
        >
          {s === "inline" ? t("compose.sourceInline") : t("compose.sourceGit")}
        </button>
      ))}
    </div>
  );
}

export function ComposeGitFields({
  form,
  projectId,
  projectSlug,
}: {
  form: ComposeForm;
  projectId: ProjectId;
  projectSlug: ProjectSlug;
}) {
  // Same repo-selection surface git services use: an account/repo picker over
  // the connected GitHub App installations (private-capable). `gitRepoId` bound
  // → clone via the installation token; a pasted public URL is the fallback.
  // `bindingProjectId` (string | null) is the one RepoPicker/PublicRepoCTA want;
  // the branded `projectId` prop is what useUniqueStackName needs.
  const { t } = useTranslation();
  const {
    installations,
    projectId: bindingProjectId,
    hasInstallations,
  } = useBindingSummary(projectSlug);
  const gitRepoId = useSelector(form.store, (s) => s.values.file.gitRepoId);
  const gitRepoUrl = useSelector(form.store, (s) => s.values.file.gitRepoUrl);
  const repoFullName = useSelector(form.store, (s) => s.values.file.repoFullName);
  const subdirInputId = useId();
  // Placeholder name for a blank field: the repo URL's last path segment.
  const derivedName = stackNamePlaceholder("git", gitRepoUrl, null);

  return (
    <>
      {hasInstallations ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">{t("compose.gitRepository")}</span>
          <RepoPicker
            installations={installations}
            projectId={bindingProjectId}
            onBound={(repoId, fullName) => {
              form.setFieldValue("file.gitRepoId", repoId);
              form.setFieldValue("file.repoFullName", fullName);
              // Bound repo wins over any pasted URL.
              form.setFieldValue("file.gitRepoUrl", "");
            }}
          />
          {repoFullName ? (
            <span className="font-mono text-[11px] text-muted-foreground">
              {t("compose.gitSelected", { name: repoFullName })}
            </span>
          ) : null}
        </div>
      ) : null}

      {gitRepoId ? null : (
        <form.Field name="file.gitRepoUrl">
          {(field) => (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">
                {hasInstallations ? t("compose.gitPublicUrlAlt") : t("compose.gitRepositoryUrl")}
              </span>
              <Input
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="https://github.com/owner/repo"
                className="font-mono"
              />
            </label>
          )}
        </form.Field>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <form.Field name="file.gitRef">
          {(field) => (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">{t("compose.gitBranch")}</span>
              {gitRepoId ? (
                <BranchPicker
                  gitRepoId={gitRepoId}
                  value={field.state.value}
                  onChange={field.handleChange}
                />
              ) : (
                <Input
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="main"
                  className="font-mono"
                />
              )}
            </label>
          )}
        </form.Field>
        <ComposeFileField form={form} />
      </div>

      <form.Field name="file.sourceSubdir">
        {(field) => (
          <label htmlFor={subdirInputId} className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              {t("compose.gitRootDirectory")}{" "}
              <span className="text-muted-foreground/60">{t("compose.optional")}</span>
            </span>
            <Input
              id={subdirInputId}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder={t("compose.gitRepoRoot")}
              className="font-mono"
            />
          </label>
        )}
      </form.Field>

      <ComposeNameField form={form} projectId={projectId} derivedName={derivedName} />
      <p className="text-[11px] text-muted-foreground">
        {t("compose.gitBlurbBefore")} <code>build:</code> {t("compose.gitBlurbAfter")}
      </p>
    </>
  );
}

export function ComposeInlineFields({
  form,
  projectId,
  fileInput,
  editorRef,
  parseContent,
  parsing,
  preview,
  hasPrefill,
}: {
  form: ComposeForm;
  projectId: ProjectId;
  fileInput: React.RefObject<HTMLInputElement | null>;
  editorRef: React.RefObject<ReactCodeMirrorRef | null>;
  parseContent: (value: string) => Promise<string | undefined>;
  parsing: boolean;
  preview: Preview | null;
  /** A template seeded the file: services lead, the file folds away. */
  hasPrefill: boolean;
}) {
  // Placeholder name for a blank field: the compose file's own `name:`.
  const derivedName = stackNamePlaceholder("inline", "", preview?.name);
  const buildServices = preview?.services.filter((s) => s.hasBuild) ?? [];
  // Membership set for the expose toggles. Memoized on the array so it is NOT
  // reallocated every render (the old `new Set(useStore(...))` was). The Set
  // only changes when the exposed list actually changes.
  const exposedList = useSelector(form.store, (s) => s.values.file.exposed);
  const exposed = useMemo(() => new Set(exposedList), [exposedList]);
  const toggleExpose = (key: string) => {
    const cur = form.state.values.file.exposed;
    form.setFieldValue(
      "file.exposed",
      cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key],
    );
  };

  // Services first. The parsed list is the thing the operator confirms, so it
  // renders above the file rather than below a 44vh editor they had to scroll
  // past. ComposeFilePanel keeps the file (and its supporting files) one click
  // away; the stack name follows both, since it is the last thing decided.
  return (
    <>
      <ComposePreview
        parsing={parsing}
        preview={preview}
        buildServices={buildServices}
        exposed={exposed}
        onToggleExpose={toggleExpose}
      />

      <ComposeFilePanel
        form={form}
        fileInput={fileInput}
        editorRef={editorRef}
        parseContent={parseContent}
        hasPrefill={hasPrefill}
      />

      <ComposeNameField form={form} projectId={projectId} derivedName={derivedName} />
    </>
  );
}
