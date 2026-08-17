/**
 * The optional stack-name field for the Compose wizard, with its live
 * collision indicator. Split out of compose-wizard-fields.tsx to keep that
 * file under the line cap.
 *
 * The `useUniqueStackName` hook is resolved right here rather than threaded
 * from the owner: it is query-backed, so this call and the owner's write-time
 * call share one manifest-cache entry and stay in lockstep. The "already
 * exists" note and the name actually staged never disagree.
 */

import type { ProjectId } from "@otterdeploy/shared/id";

import { useSelector } from "@tanstack/react-form";

import { Input } from "@/shared/components/ui/input";

import type { ComposeForm } from "./compose-wizard-shared";

import { useUniqueStackName } from "./use-unique-stack-name";

export function ComposeNameField({
  form,
  projectId,
  derivedName,
}: {
  form: ComposeForm;
  projectId: ProjectId;
  derivedName: string;
}) {
  const name = useSelector(form.store, (s) => s.values.file.name);
  const unique = useUniqueStackName(projectId, name, derivedName);
  return (
    <form.Field name="file.name">
      {(field) => (
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">
            Stack name <span className="text-muted-foreground/60">(optional)</span>
          </span>
          <Input
            value={field.state.value}
            onChange={(e) => field.handleChange(e.target.value)}
            placeholder={derivedName}
            className="font-mono"
          />
          {/* Already-in-project notice: not an error: we just stage a new copy
              under the bumped name so a re-deployed template doesn't silently
              overwrite the existing stack. */}
          {unique.collides ? (
            <span className="text-[11px] text-muted-foreground">
              A stack named <span className="font-mono">{unique.base}</span> already exists. This
              one deploys as <span className="font-mono text-foreground">{unique.name}</span>.
            </span>
          ) : null}
        </label>
      )}
    </form.Field>
  );
}
