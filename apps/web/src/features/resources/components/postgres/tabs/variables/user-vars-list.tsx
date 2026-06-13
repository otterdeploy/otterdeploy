// Thin wrapper that mounts the staged variables editor inside the
// existing tab. The `addingSignal` prop comes from the tab header's
// "New Variable" button so the editor can react to that external action.

import type { VariablesEditorResource } from "@/features/resources/components/_shared/variables-editor";
import { VariablesEditor } from "@/features/resources/components/_shared/variables-editor";

interface UserVarsListProps {
  resource: VariablesEditorResource;
  addingSignal: number;
}

export function UserVarsList({ resource, addingSignal }: UserVarsListProps) {
  return <VariablesEditor resource={resource} addRowSignal={addingSignal} />;
}
