/**
 * Variables for every service in a stack, grouped by service.
 *
 * A stack had no variables view at all: the Services tab showed image, ports
 * and volumes, and env lived one level down in each child's own panel. So
 * answering "what is this stack actually configured with". The question you
 * ask when something crash-loops: meant opening each service in turn and
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
  // Masked, not omitted: the operator needs to know the key HAS a value. An
  // empty required secret is the usual reason a stack will not start, without
  // the value itself landing in a screenshot or a screen share.
  return (
    <span className="text-muted-foreground/70" title="Hidden. Open the service to reveal.">
      {value ? "••••••••" : "(empty)"}
    </span>
  );
}

/**
 * A value carrying newlines: a whole YAML/JSON document stuffed into one
 * variable, which several templates do (LiveKit ships its entire config that
 * way as LIVEKIT_CONFIG).
 *
 * `truncate` is `white-space: nowrap` — it collapsed such a value onto one
 * clipped line, so the structure that makes it readable was exactly what got
 * thrown away. Preserve the newlines, cap the height so one big config can't
 * push the rest of the stack off the tab, and let it scroll in place.
 */
function MultilineValue({ value }: { value: string }) {
  return (
    <pre className="max-h-56 overflow-auto rounded-md bg-muted/40 px-2 py-1.5 text-[11px] leading-relaxed break-words whitespace-pre-wrap text-foreground/85">
      {value}
    </pre>
  );
}

/**
 * One key/value row. Single-line values keep the compact two-column shape;
 * a multi-line one stacks so the value gets the full width it needs, with the
 * line count next to the key so the row still reads at a glance.
 *
 * Secrets stay masked either way — a multi-line secret is still a secret, and
 * its shape is not worth leaking to a screen share.
 */
function VarRow({ name, value, secret }: { name: string; value: string; secret: boolean }) {
  if (secret || !value.includes("\n")) {
    return (
      <div className="flex items-baseline gap-3 px-3 py-1.5 font-mono text-[11.5px]">
        <span className="w-56 shrink-0 truncate text-foreground/85">{name}</span>
        <span className="min-w-0 flex-1 truncate">
          {secret ? <SecretValue value={value} /> : value}
        </span>
      </div>
    );
  }
  const lines = value.replace(/\n$/, "").split("\n").length;
  return (
    <div className="flex flex-col gap-1.5 px-3 py-2 font-mono text-[11.5px]">
      <div className="flex items-baseline gap-2">
        <span className="truncate text-foreground/85">{name}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground">{lines} lines</span>
      </div>
      <MultilineValue value={value} />
    </div>
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
          No variables. This service runs on its image defaults.
        </p>
      ) : (
        <div className="divide-y divide-border/40">
          {keys.map((k) => (
            <VarRow key={k} name={k} value={env[k] ?? ""} secret={isSecret(k)} />
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
        No services materialized yet. Variables appear once the stack deploys.
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
