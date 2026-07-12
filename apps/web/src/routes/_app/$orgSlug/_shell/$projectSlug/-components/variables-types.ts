import type { VariableRow } from "@/features/projects/data/variables";

export type CellStatus = "set" | "missing" | "empty";

export interface EnvironmentRef {
  id: string;
  slug: string;
  name: string;
}

// Row shape inferred from the collection (the wire shape of
// `project.envVar.list`) — never hand-written.
export type EnvVarRow = VariableRow;
