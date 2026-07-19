// Reveal/copy state is shared between the service + system read-only
// sections so the eye/copy toggles work the same across both. The user
// vars editor owns its own reveal/copy state internally.

import type { ProjectId } from "@otterdeploy/shared/id";

import { useState } from "react";

import { useQuery } from "@tanstack/react-query";

import { useStageManifestChange } from "@/features/projects/hooks/use-manifest-stage";
import { VariableRefHint } from "@/features/resources/components/_shared/hint-banner";
import { VariablesEditor } from "@/features/resources/components/_shared/variables-editor";
import { copyToClipboard } from "@/shared/lib/clipboard";
import { orpc } from "@/shared/server/orpc";

import type { PostgresBodyProps } from "../../types";

import { buildEngineServiceVars, buildSystemVars } from "./engine-service-vars";
import { HeaderBar } from "./header-bar";
import { ServiceVarsList } from "./service-vars-list";
import { SystemVarsList } from "./system-vars-list";
import { UserVarsList } from "./user-vars-list";

export function PostgresVariablesTabBody({
  resource,
  pending = false,
  dbName,
}: {
  resource: PostgresBodyProps["resource"];
  // Pending-create mode: no live database, so only the user var bag is
  // editable and saves stage onto `databases[dbName].extraEnv`. The
  // engine-exported + system vars (connection strings, credentials) don't
  // exist until the database is provisioned, so they're hidden.
  pending?: boolean;
  dbName?: string;
}) {
  if (pending) {
    return <PendingVariables resource={resource} dbName={dbName} />;
  }
  return <ProvisionedVariables resource={resource} />;
}

function ProvisionedVariables({ resource }: { resource: PostgresBodyProps["resource"] }) {
  const serviceVars = buildEngineServiceVars(resource);
  const systemVars = buildSystemVars(resource);

  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [hintDismissed, setHintDismissed] = useState(false);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [addingSignal, setAddingSignal] = useState(0);

  const matches = (name: string) => !query || name.toLowerCase().includes(query.toLowerCase());

  const filteredService = serviceVars.filter((v) => matches(v.name));
  const filteredSystem = systemVars.filter((v) => matches(v.name));

  const toggleReveal = (name: string) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  // Per-key tick that auto-clears so multiple copies stay visually independent.
  const copyValue = (value: string, name: string) => {
    void copyToClipboard(value).then((ok) => {
      if (!ok) return;
      setCopiedKey(name);
      window.setTimeout(() => {
        setCopiedKey((cur) => (cur === name ? null : cur));
      }, 1400);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <HeaderBar
        serviceCount={serviceVars.length}
        query={query}
        searchOpen={searchOpen}
        onToggleSearch={() => setSearchOpen((p) => !p)}
        onQueryChange={setQuery}
        onAdd={() => setAddingSignal((n) => n + 1)}
      />

      {!hintDismissed && <VariableRefHint onDismiss={() => setHintDismissed(true)} />}

      <ServiceVarsList
        filteredService={filteredService}
        query={query}
        revealed={revealed}
        copiedKey={copiedKey}
        onToggleReveal={toggleReveal}
        onCopy={copyValue}
      />

      <UserVarsList resource={resource} addingSignal={addingSignal} />

      <SystemVarsList
        systemVars={systemVars}
        filteredSystem={filteredSystem}
        query={query}
        revealed={revealed}
        copiedKey={copiedKey}
        onToggleReveal={toggleReveal}
        onCopy={copyValue}
      />
    </div>
  );
}

/** Staged-create variables: the editable user bag (persisted to the manifest
 *  entry's `extraEnv`) PLUS the engine's REAL connection vars. The credentials
 *  are minted at stage time (deterministic identity + a stable random password)
 *  and reused verbatim at deploy — so what's shown here is exactly what the
 *  deployed database uses, copyable right now. */
function PendingVariables({
  resource,
  dbName,
}: {
  resource: PostgresBodyProps["resource"];
  dbName?: string;
}) {
  const stage = useStageManifestChange(resource.projectId as ProjectId, {
    successToast: "Variables staged — Deploy to apply",
  });
  const [hintDismissed, setHintDismissed] = useState(false);
  const [addingSignal, setAddingSignal] = useState(0);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Mint (or read) the staged credentials — real username/password/db/URL the
  // deployed database will use. Server-side derivation, so it can't drift.
  const creds = useQuery(
    orpc.project.resource.database.postgres.draftCredentials.queryOptions({
      input: {
        projectId: resource.projectId,
        name: dbName ?? resource.name,
        engine: resource.engine,
      },
      enabled: Boolean(dbName),
      staleTime: Infinity,
    }),
  );

  // Build the engine var list with the REAL minted values (same per-engine
  // shape the deployed panel renders).
  const engineVars = creds.data
    ? buildEngineServiceVars({
        ...resource,
        username: creds.data.username,
        password: creds.data.password,
        databaseName: creds.data.databaseName,
        internalConnectionString: creds.data.internalConnectionString,
      })
    : [];

  const toggleReveal = (name: string) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  const copyValue = (value: string, name: string) => {
    void copyToClipboard(value).then((ok) => {
      if (!ok) return;
      setCopiedKey(name);
      window.setTimeout(() => setCopiedKey((cur) => (cur === name ? null : cur)), 1400);
    });
  };

  const onSave = dbName
    ? async (env: Array<{ key: string; value: string }>) => {
        await stage.mutateAsync((m) => {
          const db = m.databases[dbName];
          if (!db) return m;
          return {
            ...m,
            databases: {
              ...m.databases,
              [dbName]: {
                ...db,
                extraEnv: Object.fromEntries(env.map((e) => [e.key, e.value])),
              },
            },
          };
        });
      }
    : undefined;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2.5">
        <span className="text-[14px] font-semibold">{resource.engine} variables</span>
        <p className="text-[12px] text-muted-foreground">
          {resource.engine} exports these into the container. They&apos;re live now and stay the
          same after deploy — reference them from other services with{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
            ${"{"}
            {dbName ?? resource.name}.DATABASE_URL{"}"}
          </code>
          .
        </p>
        {creds.isLoading ? (
          <div className="rounded-xl border px-3.5 py-6 text-center text-[12.5px] text-muted-foreground">
            Generating credentials…
          </div>
        ) : (
          <ServiceVarsList
            filteredService={engineVars}
            query=""
            revealed={revealed}
            copiedKey={copiedKey}
            onToggleReveal={toggleReveal}
            onCopy={copyValue}
          />
        )}
      </div>

      <div className="flex flex-col gap-4">
        <HeaderBar
          serviceCount={Object.keys(resource.extraEnv ?? {}).length}
          query=""
          searchOpen={false}
          onToggleSearch={() => {}}
          onQueryChange={() => {}}
          onAdd={() => setAddingSignal((n) => n + 1)}
        />
        {!hintDismissed && <VariableRefHint onDismiss={() => setHintDismissed(true)} />}
        <VariablesEditor resource={resource} addRowSignal={addingSignal} onSave={onSave} />
      </div>
    </div>
  );
}
