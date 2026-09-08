/**
 * One environment's row in project settings: its display name, its slug, and
 * whether it is private.
 *
 * The name is editable and the slug is not, which is the whole point of
 * showing them together. The slug is baked into every scoped runtime name -
 * container suffixes (`web-admin-staging`), internal hostnames
 * (`postgres-staging.<project>.otterdeploy.internal`), the environment's
 * overlay network, and the manifest's `environments.<slug>` key - so renaming
 * it would orphan every running container from its row. Showing it inert next
 * to an editable name answers "why can I only change half of this?" before it
 * is asked.
 */

import { useState } from "react";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Switch } from "@/shared/components/ui/switch";
import { orpc, queryClient } from "@/shared/server/orpc";

export interface EnvironmentRowData {
  id: string;
  name: string;
  slug: string;
  protected: boolean;
}

function refreshEnvironments() {
  void queryClient.invalidateQueries({ queryKey: orpc.env.list.queryKey() });
}

export function EnvironmentRow({ env }: { env: EnvironmentRowData }) {
  const [name, setName] = useState(env.name);
  const trimmed = name.trim();
  const dirty = trimmed.length > 0 && trimmed !== env.name;

  const renameMut = useMutation({
    ...orpc.env.rename.mutationOptions(),
    onSuccess: (updated) => {
      toast.success(`Renamed to ${updated.name}`);
      refreshEnvironments();
    },
    onError: (err) => {
      setName(env.name);
      toast.error(err.message ?? "Rename failed");
    },
  });

  const protectionMut = useMutation({
    ...orpc.env.setProtection.mutationOptions(),
    onSuccess: (updated) => {
      toast.success(
        updated.protected
          ? `${updated.name} is private. Every route in it requires sign-in.`
          : // Not "everything is public now": the floor is additive, so a route
            // locked on its own keeps its own setting. Saying otherwise here
            // would be the one wrong direction to be confident about.
            `${updated.name} is public. Routes protected on their own stay protected.`,
      );
      refreshEnvironments();
    },
    onError: (err) => toast.error(err.message ?? "Could not change protection"),
  });

  return (
    <div className="flex flex-wrap items-center gap-3 border-t px-4 py-3 first:border-t-0">
      <div className="flex min-w-[16rem] flex-1 items-center gap-2">
        <Input
          value={name}
          aria-label={`Name of the ${env.slug} environment`}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && dirty) renameMut.mutate({ id: env.id, name: trimmed });
            if (e.key === "Escape") setName(env.name);
          }}
          className="h-8"
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={!dirty || renameMut.isPending}
          onClick={() => renameMut.mutate({ id: env.id, name: trimmed })}
        >
          {renameMut.isPending ? "Saving…" : "Rename"}
        </Button>
      </div>

      <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11.5px] text-muted-foreground">
        {env.slug}
      </code>

      <label className="flex shrink-0 items-center gap-2 text-[12.5px]">
        <Switch
          checked={env.protected}
          disabled={protectionMut.isPending}
          onCheckedChange={(checked) => protectionMut.mutate({ id: env.id, protected: checked })}
        />
        <span className="w-[7ch] text-muted-foreground">
          {env.protected ? "Private" : "Public"}
        </span>
      </label>
    </div>
  );
}
