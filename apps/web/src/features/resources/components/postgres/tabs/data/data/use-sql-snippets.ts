/**
 * SQL snippet store — TanStack DB LocalStorage collections.
 *
 * Snippets and folders are browser-local and scoped to the opened database via
 * a `resourceId` field: a single shared collection per kind, filtered in the
 * live query — the same "one collection, scope with a where" pattern as
 * `resourceCollection`. A single "Playground" scratch buffer is *always*
 * available regardless of which database is open (its own global row).
 *
 * Persistence and cross-tab sync are handled by `localStorageCollectionOptions`
 * (it writes through to `localStorage` on every mutation and listens for
 * storage events) — nothing here touches the server. These are the user's
 * personal scratchpads.
 */
import { useCallback } from "react";
import { createCollection, localStorageCollectionOptions } from "@tanstack/db";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { z } from "zod";

/** Sentinel id for the always-available, cross-database scratch buffer. */
export const PLAYGROUND_ID = "playground";

/** The single global Playground row (one buffer shared across databases). */
const PLAYGROUND_ROW_ID = "__global__";

const DEFAULT_PLAYGROUND = `-- Snippets are stored in browser storage with relation to opened database.
-- You can create new snippets by clicking the "+" button and group them in folders.
-- Playground is always available, regardless of the database.

SELECT * FROM <table> LIMIT 10;`;

// ─── Schemas ──────────────────────────────────────────────────────────────

const sqlFolderSchema = z.object({
  id: z.string(),
  resourceId: z.string(),
  name: z.string(),
});
export type SqlFolder = z.infer<typeof sqlFolderSchema>;

const sqlSnippetSchema = z.object({
  id: z.string(),
  resourceId: z.string(),
  name: z.string(),
  sql: z.string(),
  /** null = top level (no folder). */
  folderId: z.string().nullable(),
  updatedAt: z.number(),
});
export type SqlSnippet = z.infer<typeof sqlSnippetSchema>;

const sqlPlaygroundSchema = z.object({
  id: z.string(),
  sql: z.string(),
});

// ─── Collections (module-level singletons) ──────────────────────────────────

const sqlFolderCollection = createCollection(
  localStorageCollectionOptions({
    id: "sql-folders",
    storageKey: "otter:sql-folders",
    getKey: (f) => f.id,
    schema: sqlFolderSchema,
  }),
);

const sqlSnippetCollection = createCollection(
  localStorageCollectionOptions({
    id: "sql-snippets",
    storageKey: "otter:sql-snippets",
    getKey: (s) => s.id,
    schema: sqlSnippetSchema,
  }),
);

const sqlPlaygroundCollection = createCollection(
  localStorageCollectionOptions({
    id: "sql-playground",
    storageKey: "otter:sql-playground-buffer",
    getKey: (p) => p.id,
    schema: sqlPlaygroundSchema,
  }),
);

function uid(): string {
  // crypto.randomUUID is available in every browser we target.
  return crypto.randomUUID();
}

/**
 * Snippet CRUD for one resource plus the shared Playground buffer. Folders and
 * snippets come from live queries scoped to `resourceId`; mutations write
 * straight to the collections (which persist + broadcast to other tabs).
 */
export function useSqlSnippets(resourceId: string) {
  const { data: folders } = useLiveQuery(
    (q) =>
      q
        .from({ f: sqlFolderCollection })
        .where(({ f }) => eq(f.resourceId, resourceId)),
    [resourceId],
  );

  const { data: snippets } = useLiveQuery(
    (q) =>
      q
        .from({ s: sqlSnippetCollection })
        .where(({ s }) => eq(s.resourceId, resourceId))
        .orderBy(({ s }) => s.updatedAt, "desc"),
    [resourceId],
  );

  const { data: playgroundRows } = useLiveQuery(
    (q) =>
      q
        .from({ p: sqlPlaygroundCollection })
        .where(({ p }) => eq(p.id, PLAYGROUND_ROW_ID)),
    [],
  );
  const playground = playgroundRows[0]?.sql ?? DEFAULT_PLAYGROUND;

  const setPlayground = useCallback((sql: string) => {
    if (sqlPlaygroundCollection.has(PLAYGROUND_ROW_ID)) {
      sqlPlaygroundCollection.update(PLAYGROUND_ROW_ID, (draft) => {
        draft.sql = sql;
      });
    } else {
      sqlPlaygroundCollection.insert({ id: PLAYGROUND_ROW_ID, sql });
    }
  }, []);

  const addFolder = useCallback(
    (name: string): SqlFolder => {
      const folder: SqlFolder = {
        id: uid(),
        resourceId,
        name: name.trim() || "New folder",
      };
      sqlFolderCollection.insert(folder);
      return folder;
    },
    [resourceId],
  );

  const renameFolder = useCallback((id: string, name: string) => {
    const next = name.trim();
    if (!next) return;
    sqlFolderCollection.update(id, (draft) => {
      draft.name = next;
    });
  }, []);

  /** Deleting a folder keeps its snippets, moving them to the top level. */
  const deleteFolder = useCallback(
    (id: string) => {
      for (const s of snippets) {
        if (s.folderId === id) {
          sqlSnippetCollection.update(s.id, (draft) => {
            draft.folderId = null;
          });
        }
      }
      sqlFolderCollection.delete(id);
    },
    [snippets],
  );

  const addSnippet = useCallback(
    (init?: {
      name?: string;
      sql?: string;
      folderId?: string | null;
    }): SqlSnippet => {
      const snippet: SqlSnippet = {
        id: uid(),
        resourceId,
        name: init?.name?.trim() || "Untitled query",
        sql: init?.sql ?? "",
        folderId: init?.folderId ?? null,
        updatedAt: Date.now(),
      };
      sqlSnippetCollection.insert(snippet);
      return snippet;
    },
    [resourceId],
  );

  const updateSnippet = useCallback(
    (
      id: string,
      patch: Partial<Pick<SqlSnippet, "name" | "sql" | "folderId">>,
    ) => {
      sqlSnippetCollection.update(id, (draft) => {
        if (patch.name !== undefined) draft.name = patch.name;
        if (patch.sql !== undefined) draft.sql = patch.sql;
        if (patch.folderId !== undefined) draft.folderId = patch.folderId;
        draft.updatedAt = Date.now();
      });
    },
    [],
  );

  const deleteSnippet = useCallback((id: string) => {
    sqlSnippetCollection.delete(id);
  }, []);

  return {
    folders,
    snippets,
    playground,
    setPlayground,
    addFolder,
    renameFolder,
    deleteFolder,
    addSnippet,
    updateSnippet,
    deleteSnippet,
  };
}
