export interface DatabaseEngineMeta {
  label: string;
  defaultPort: number;
  dockerImage: string;
  versions: ReadonlyArray<string>;
  category: "relational" | "document" | "key-value" | "analytical" | "search";
}

export const DATABASE_ENGINES = {
  postgres: {
    label: "PostgreSQL",
    defaultPort: 5432,
    dockerImage: "postgres",
    versions: ["16", "15", "14"] as const,
    category: "relational",
  },
} as const satisfies Record<string, DatabaseEngineMeta>;

export type DatabaseEngine = keyof typeof DATABASE_ENGINES;

export function getDatabaseEngine(engine: DatabaseEngine): DatabaseEngineMeta {
  return DATABASE_ENGINES[engine];
}
