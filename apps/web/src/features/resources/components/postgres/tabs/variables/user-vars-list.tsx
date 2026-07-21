// Thin wrapper that mounts the staged variables editor inside the
// existing tab. Forwards a ref so the tab header's "New Variable" button
// can call the editor's `addRow` imperative handle.

import type { Ref } from "react";

import type {
  VariablesEditorHandle,
  VariablesEditorResource,
} from "@/features/resources/components/_shared/variables-editor";

import { VariablesEditor } from "@/features/resources/components/_shared/variables-editor";

interface UserVarsListProps {
  resource: VariablesEditorResource;
  ref?: Ref<VariablesEditorHandle>;
}

export function UserVarsList({ resource, ref }: UserVarsListProps) {
  return <VariablesEditor ref={ref} resource={resource} />;
}
