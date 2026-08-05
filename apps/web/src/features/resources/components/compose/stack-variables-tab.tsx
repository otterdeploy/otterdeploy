/**
 * Variables for every service in a stack, grouped by service.
 *
 * A stack had no variables view at all: the Services tab showed image, ports
 * and volumes, and env lived one level down in each child's own panel. So
 * answering "what is this stack actually configured with" — the question you
 * ask when something crash-loops — meant opening each service in turn and
 * holding the answer in your head.
 *
 * Read from the resource collection the graph already keeps warm (children are
 * real service resources carrying `stackId`), so this costs no extra request.
 */

import { isSecretKey } from "@otterdeploy/shared/env-var-kind";
import { eq } from "@tanstack/db";
import { useLiveQuery } from "@tanstack/react-db";

import { resourceCollection } from "@/features/resources/data/resource";
import { Skeleton } from "@/shared/components/ui/skeleton";

function SecretValue({ value }: { value: string }) {
  // Masked, not omitted: the operator needs to know the key HAS a value — an
  // empty required secret is the usual reason a stack will not start — without
  // the value itself landing in a screenshot or a screen share.
  return (
    <span className="text-muted-foreground/70" title="Hidden — open the service to reveal">
      {value ? "••••••••" : "(empty)"}
    </span>
  );
}

function ServiceVars({
  name,
  env,
  secretKeys,
}: {
  name: string;
  env: Record<string, string>;
  secretKeys: string[];
}) {
  const keys = Object.keys(env).sort();
  // Classify as well as trust the stored flag. Compose-created services were
  // written with `is_secret` unset for every key, so a view that only trusted
  // the column printed AUTHENTIK_SECRET_KEY and POSTGRES_PASSWORD in the clear.
  // The write path sets it now, but rows already in the database never will.
  const stored = new Set(secretKeys);
  const isSecret = (k: string) => stored.has(k) || isSecretKey(k);
  return (
    <section className="rounded-lg ring-1 ring-foreground/10">
      <header className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
        <span className="font-mono text-[12.5px] font-medium">{name}</span>
        <span className="text-[11px] text-muted-foreground">
          {keys.length} variable{keys.length === 1 ? "" : "s"}
        </span>
      </header>
      {keys.length === 0 ? (
        <p className="px-3 py-2.5 text-[11.5px] text-muted-foreground">
          No variables — this service runs on its image defaults.
        </p>
      ) : (
        <div className="divide-y divide-border/40">
          {keys.map((k) => (
            <div key={k} className="flex items-baseline gap-3 px-3 py-1.5 font-mono text-[11.5px]">
              <span className="w-56 shrink-0 truncate text-foreground/85">{k}</span>
              <span className="min-w-0 flex-1 truncate">
                {isSecret(k) ? <SecretValue value={env[k] ?? ""} /> : (env[k] ?? "")}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function StackVariablesTab({
  projectId,
  stackResourceId,
}: {
  projectId: string;
  stackResourceId: string;
}) {
  // Scoped by project in the query; the stack filter runs in JS because
  // `stackId` exists only on the service branch of the row union and the query
  // builder types against all three.
  const { data: rows, isLoading } = useLiveQuery(
    (q) => q.from({ r: resourceCollection }).where(({ r }) => eq(r.projectId, projectId)),
    [projectId],
  );
  const children = rows.filter(
    (r) => r.type === "service" && "stackId" in r && r.stackId === stackResourceId,
  );

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }
  if (children.length === 0) {
    return (
      <p className="text-[12px] text-muted-foreground">
        No services materialized yet — variables appear once the stack deploys.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {[...children]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => (
          <ServiceVars
            key={c.resourceId}
            name={c.name}
            env={("extraEnv" in c ? c.extraEnv : null) ?? {}}
            secretKeys={("secretKeys" in c ? c.secretKeys : null) ?? []}
          />
        ))}
    </div>
  );
}
