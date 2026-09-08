/**
 * The environments a project owns, and the two things an operator can change
 * about one: its display name and whether it is private.
 *
 * Both already existed as API + CLI only, which meant they did not exist for
 * anyone working in the dashboard. Rename in particular is the kind of thing
 * you reach for the moment you mistype a name, and "delete the environment and
 * everything it owns, then recreate it" is not an answer.
 */

import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/shared/server/orpc";

import { EnvironmentRow, type EnvironmentRowData } from "./environment-row";

export function EnvironmentsSection({ projectId }: { projectId: string }) {
  const { data, isPending, isError } = useQuery(
    orpc.env.list.queryOptions({ input: { projectId } }),
  );

  const environments: EnvironmentRowData[] = (data ?? []).map((env) => ({
    id: env.id,
    name: env.name,
    slug: env.slug,
    protected: env.protected,
  }));

  return (
    <section className="rounded-md border bg-card">
      <header className="p-5 pb-3">
        <h2 className="text-[14px] font-semibold">Environments</h2>
        <p className="text-[12.5px] text-muted-foreground">
          Rename an environment, or make it private so every route in it requires sign-in. The slug
          cannot change: it is part of every container name, internal hostname and network this
          environment owns.
        </p>
      </header>

      {isPending ? (
        <p className="px-5 pb-5 text-[12.5px] text-muted-foreground">Loading…</p>
      ) : isError ? (
        <p className="px-5 pb-5 text-[12.5px] text-destructive">Could not load environments.</p>
      ) : environments.length === 0 ? (
        <p className="px-5 pb-5 text-[12.5px] text-muted-foreground">
          This project has no environments yet.
        </p>
      ) : (
        <div className="border-t">
          {environments.map((env) => (
            <EnvironmentRow key={env.id} env={env} />
          ))}
        </div>
      )}
    </section>
  );
}
