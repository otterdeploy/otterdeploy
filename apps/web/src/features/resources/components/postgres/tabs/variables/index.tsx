// Reveal/copy state is shared between the service + system read-only
// sections so the eye/copy toggles work the same across both. The user
// vars editor owns its own reveal/copy state internally.

import { useMemo, useState } from "react";

import type { PostgresBodyProps } from "../../types";
import { VariableRefHint } from "@/features/resources/components/_shared/hint-banner";
import { buildEngineServiceVars, buildSystemVars } from "./engine-service-vars";
import { HeaderBar } from "./header-bar";
import { ServiceVarsList } from "./service-vars-list";
import { SystemVarsList } from "./system-vars-list";
import { UserVarsList } from "./user-vars-list";

export function PostgresVariablesTabBody({
  resource,
}: {
  resource: PostgresBodyProps["resource"];
}) {
  const serviceVars = useMemo(() => buildEngineServiceVars(resource), [resource]);
  const systemVars = useMemo(() => buildSystemVars(resource), [resource]);

  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [hintDismissed, setHintDismissed] = useState(false);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [addingSignal, setAddingSignal] = useState(0);

  const matches = (name: string) =>
    !query || name.toLowerCase().includes(query.toLowerCase());

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
    void navigator.clipboard?.writeText(value);
    setCopiedKey(name);
    window.setTimeout(() => {
      setCopiedKey((cur) => (cur === name ? null : cur));
    }, 1400);
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

      {!hintDismissed && (
        <VariableRefHint onDismiss={() => setHintDismissed(true)} />
      )}

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
