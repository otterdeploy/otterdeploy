import { createContext, useContext } from "react";

export interface PendingChange {
  id: string;
  name: string;
  kind: string;
  databaseEngine?:
    | "postgresql"
    | "mysql"
    | "mariadb"
    | "mongodb"
    | "redis"
    | "keydb"
    | "dragonfly"
    | "clickhouse";
  action: "added" | "modified" | "removed";
  settings: { key: string; oldValue: string; newValue: string }[];
}

export interface ProjectContext {
  envSlug: string;
  environmentId: string | undefined;
  pendingChanges: PendingChange[];
  onCreateResource: (resource: {
    id: string;
    name: string;
    kind: string;
    status: string;
    databaseEngine?: PendingChange["databaseEngine"];
  }) => void;
  onMarkForRemoval: (id: string) => void;
  onRedeploy: (resource: {
    id: string;
    kind: string;
    databaseEngine?: PendingChange["databaseEngine"];
  }) => Promise<void>;
}

export const ProjectContext = createContext<ProjectContext | null>(null);

export function useProjectContext() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProjectContext must be used within ProjectContext");
  return ctx;
}
