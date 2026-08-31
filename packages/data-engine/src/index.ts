/**
 * @otterdeploy/data-engine — everything about talking to a SQL database that
 * does not depend on how you reach it.
 *
 * Pure and isomorphic on purpose: no drivers, no Docker, no React. The server
 * imports it to build statements; the web app imports the same module to render
 * cells, validate edits and compile the filter bar, so the two sides cannot
 * drift on what a `numeric` is or which filters are legal.
 *
 * Statement SPLITTING and classification deliberately live in the web app
 * (`postgres/tabs/data/data/sql-statements.ts`), not here. Only the editor needs
 * them — the server never classifies a statement, because read-only is enforced
 * on the session — and CodeMirror already parses the document with
 * `@codemirror/lang-sql`, so its syntax tree is a better source for statement
 * boundaries than a second hand-rolled scanner would be.
 */
export * from "./dialect";
export * from "./dialects";
export * from "./filters";
export * from "./mutate";
export * from "./types";
export * from "./value";
