import type { ServiceKind } from "@/features/projects/data/service-kinds";

import { useFormContext } from "../form-context";
import { SectionHeader } from "../form-primitives";

interface StepVariablesProps {
  kind: ServiceKind | null;
}

export function StepVariables(_props: StepVariablesProps) {
  const form = useFormContext();

  // No auto-injected previews here yet — the wizard creates a fresh
  // service, so cross-resource refs like `${{postgres.DATABASE_URL}}`
  // can be added after creation via the resource panel's variables tab
  // (where they actually resolve against the project's real resources).
  // Linked external secret managers (Vault, AWS SM, …) aren't wired
  // server-side; the picker has been removed until they ship.
  return (
    <>
      <SectionHeader
        title="Environment variables"
        sub="Add key/value pairs — toggle the lock to mark a value as secret. Cross-resource references can be added after the service is created."
      />
      <form.AppField name="variables">
        {(f) => <f.VariablesField />}
      </form.AppField>
    </>
  );
}
