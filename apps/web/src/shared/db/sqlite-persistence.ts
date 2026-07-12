import type { PersistedCollectionPersistence } from "@tanstack/browser-db-sqlite-persistence";

import {
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
} from "@tanstack/browser-db-sqlite-persistence";

/**
 * SPIKE: client-side SQLite persistence for TanStack DB collections.
 *
 * The browser engine is wa-sqlite running in a dedicated Web Worker over an
 * OPFS-backed database (OPFSCoopSyncVFS — no COOP/COEP or SharedArrayBuffer
 * required; the worker + `.wasm` ship as one self-contained bundled asset that
 * Vite loads via `new Worker(new URL(...))`).
 *
 * Two shapes to be aware of:
 *
 *   1. Opening the OPFS database is **async**, but our collections are
 *      module-level singletons created synchronously. So this module resolves
 *      the shared persistence handle with a top-level await (the app's ESM
 *      target supports it) and exports the settled value. Any collection that
 *      wraps itself in `persistedCollectionOptions` imports `persistence` from
 *      here. The one-time cost is that the first import of a persisted
 *      collection blocks on OPFS init (~tens of ms).
 *
 *   2. OPFS/Worker aren't available everywhere (SSR, vitest/node, older or
 *      privacy-restricted browsers). Rather than crash the module graph, we
 *      swallow a failed open to `null` and let callers fall back to a plain,
 *      in-memory query collection. `openBrowserWASQLiteOPFSDatabase` already
 *      rejects when prerequisites are missing, so the `.catch` covers it.
 *
 * A single persistence instance is intended to be shared by many collections
 * on the same database, so this is deliberately one module-level singleton.
 */

const DATABASE_NAME = "otterstack";

export const persistence: PersistedCollectionPersistence | null =
  typeof window === "undefined"
    ? null
    : await openBrowserWASQLiteOPFSDatabase({ databaseName: DATABASE_NAME })
        .then((database) => createBrowserWASQLitePersistence({ database }))
        .catch(() => {
          // Non-fatal: collections fall back to in-memory query sync.
          return null;
        });
