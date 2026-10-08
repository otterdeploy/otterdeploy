import { useState } from "react";

/**
 * The stack's own variables: what its `${VAR}` references resolve to, and
 * from which scope.
 *
 * Before stacks had a scope, every stack's `${VAR}` values lived in the
 * project variables, where any other stack reading the same generic name
 * (POSTGRES_PASSWORD, JWT_SECRET) shared them, and one template's install
 * could rotate another stack's credential. Each row here therefore
 * says where its value comes from, because "which scope wins" is the question
 * an operator asks before changing a credential:
 *
 *   - set on this stack            → this stack only (and says so when a
 *                                    project variable of the same name exists)
 *   - from the project             → shared; edit it on the Variables page,
 *                                    or set it here to override for this stack
 *   - the file's default / not set → what the compose file falls back to
 *
 * Writes go to the stack only and apply on the next deploy, like an edit to
 * the compose file itself.
 */
import { isSecretKey } from "@otterdeploy/shared/env-var-kind";
import { eq } from "@tanstack/db";
import { useLiveQuery } from "@tanstack/react-db";
import { Result } from "better-result";
import { toast } from "sonner";

import {
  type StackVariableRow,
  stackVariablesCollection,
} from "@/features/resources/data/stack-variables";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { cn } from "@/shared/lib/utils";

const SCOPE_LABEL: Record<Exclude<StackVariableRow["scope"], "stack">, string> = {
  project: "From project",
  default: "File default",
  missing: "Not set",
};

/** Report a collection write's outcome; the collection rolls back on reject. */
function settle(persisted: Promise<unknown>, done: string) {
  void Result.tryPromise({ try: () => persisted, catch: (cause) => cause }).then((result) => {
    if (result.isOk()) toast.success(done, { description: "Applies on the stack's next deploy." });
    else
      toast.error(result.error instanceof Error ? result.error.message : "Could not save variable");
  });
}

function ValueCell({ row }: { row: StackVariableRow }) {
  if (row.scope !== "stack") {
    return (
      <span
        className={cn(
          "font-sans text-[11.5px]",
          row.scope === "missing" ? "text-warning" : "text-muted-foreground",
        )}
      >
        {SCOPE_LABEL[row.scope]}
      </span>
    );
  }
  if (row.sealed) {
    return <span className="font-sans text-[11.5px] text-muted-foreground">Sealed</span>;
  }
  if (row.isSecret || isSecretKey(row.key)) {
    return (
      <span className="text-muted-foreground/70" title="Hidden. Edit to replace it.">
        {row.value ? "••••••••" : "(empty)"}
      </span>
    );
  }
  return <span className="truncate">{row.value || "(empty)"}</span>;
}

function EditRow({ row, onDone }: { row: StackVariableRow; onDone: () => void }) {
  const secret = row.isSecret || isSecretKey(row.key);
  // A secret is replaced, never shown: start empty rather than prefilled.
  const [value, setValue] = useState(secret ? "" : row.value);
  const save = () => {
    const tx = stackVariablesCollection.update(`${row.resourceId}:${row.key}`, (draft) => {
      draft.value = value;
      draft.scope = "stack";
      draft.isSecret = secret;
    });
    settle(tx.isPersisted.promise, `${row.key} set for this stack`);
    onDone();
  };
  return (
    <form
      className="flex items-center gap-2 px-3 py-1.5 font-mono text-[11.5px]"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label htmlFor={`stack-var-${row.key}`} className="w-56 shrink-0 truncate text-foreground/85">
        {row.key}
      </label>
      <Input
        id={`stack-var-${row.key}`}
        // Focus follows the Edit click that revealed this field, so a keyboard
        // user lands in it instead of back at the top of the tab.
        ref={(el) => el?.focus()}
        type={secret ? "password" : "text"}
        autoComplete="off"
        value={value}
        placeholder={secret ? "New value" : ""}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onDone();
        }}
        className="h-7 min-w-0 flex-1 font-mono text-[11.5px]"
      />
      <Button type="submit" size="xs" disabled={secret && value === ""}>
        Save
      </Button>
      <Button type="button" size="xs" variant="ghost" onClick={onDone}>
        Cancel
      </Button>
    </form>
  );
}

function VariableRow({ row, onEdit }: { row: StackVariableRow; onEdit: () => void }) {
  const remove = () => {
    const tx = stackVariablesCollection.delete(`${row.resourceId}:${row.key}`);
    settle(tx.isPersisted.promise, `${row.key} removed from this stack`);
  };
  return (
    <div className="flex items-center gap-3 px-3 py-1.5 font-mono text-[11.5px]">
      <span className="w-56 shrink-0 truncate text-foreground/85">{row.key}</span>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <ValueCell row={row} />
        {row.overridesProject && (
          <Badge
            variant="outline"
            className="shrink-0 font-sans"
            title="The project has a variable with this name. This stack uses its own value; the project's is unchanged."
          >
            Overrides project
          </Badge>
        )}
      </span>
      {row.scope === "stack" ? (
        <span className="flex shrink-0 gap-1 font-sans">
          <Button size="xs" variant="ghost" onClick={onEdit}>
            Edit
          </Button>
          <Button size="xs" variant="ghost" onClick={remove}>
            Remove
          </Button>
        </span>
      ) : (
        <Button size="xs" variant="ghost" className="shrink-0 font-sans" onClick={onEdit}>
          Set for this stack
        </Button>
      )}
    </div>
  );
}

export function StackOwnVariables({
  projectId,
  stackResourceId,
}: {
  projectId: string;
  stackResourceId: string;
}) {
  const { data: rows, isLoading } = useLiveQuery(
    (q) =>
      q
        .from({ v: stackVariablesCollection })
        .where(({ v }) => eq(v.projectId, projectId))
        .where(({ v }) => eq(v.resourceId, stackResourceId))
        .orderBy(({ v }) => v.key),
    [projectId, stackResourceId],
  );
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <section className="rounded-lg ring-1 ring-foreground/10" aria-labelledby="stack-vars-title">
      <header className="flex flex-col gap-0.5 border-b border-border/40 px-3 py-2">
        <div className="flex items-center gap-2">
          <span id="stack-vars-title" className="text-[12.5px] font-medium">
            Stack variables
          </span>
          <span className="text-[11px] text-muted-foreground">
            {rows.length} variable{rows.length === 1 ? "" : "s"}
          </span>
        </div>
        <p className="text-[11.5px] text-muted-foreground">
          What this stack's <code className="font-mono">{"${VAR}"}</code> references resolve to. A
          value set here applies to this stack only; project variables are never changed from here.
          Changes apply on the next deploy.
        </p>
      </header>
      {isLoading ? (
        <div className="flex flex-col gap-1.5 p-3">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-2/3" />
        </div>
      ) : rows.length === 0 ? (
        <p className="px-3 py-2.5 text-[11.5px] text-muted-foreground">
          The compose file references no variables.
        </p>
      ) : (
        <div className="divide-y divide-border/40">
          {rows.map((row) =>
            editing === row.key ? (
              <EditRow key={row.key} row={row} onDone={() => setEditing(null)} />
            ) : (
              <VariableRow key={row.key} row={row} onEdit={() => setEditing(row.key)} />
            ),
          )}
        </div>
      )}
    </section>
  );
}
