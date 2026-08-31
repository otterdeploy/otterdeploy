/**
 * What the connect form knows about each engine, plus the URL⇄fields plumbing.
 *
 * One list drives the picker grid, the scheme detection and the URL assembly,
 * so "which engines can I connect" has exactly one answer. The wire drivers
 * behind this are postgres and mysql/mariadb (see packages/api ConnectableEngine);
 * everything else is shown as coming, not hidden — a grid that pretends MySQL
 * is the only other database reads as a gap, a grid that says "soon" reads as
 * a roadmap.
 */
import { Result } from "better-result";

export interface ConnectEngine {
  id: "postgres" | "mariadb";
  label: string;
  scheme: string;
  port: number;
  placeholder: string;
}

const POSTGRES: ConnectEngine = {
  id: "postgres",
  label: "PostgreSQL",
  scheme: "postgresql",
  port: 5432,
  placeholder: "postgresql://user:password@host:5432/database",
};

const MARIADB: ConnectEngine = {
  id: "mariadb",
  label: "MySQL / MariaDB",
  scheme: "mysql",
  port: 3306,
  placeholder: "mysql://user:password@host:3306/database",
};

export const CONNECT_ENGINES: readonly ConnectEngine[] = [POSTGRES, MARIADB];

/** Real engines without a wire driver yet. Shown greyed, never faked. */
export const COMING_SOON = ["ClickHouse", "Redis", "SQL Server", "SQLite"];

const SCHEME_TO_ENGINE = new Map<string, ConnectEngine>([
  ["postgres", POSTGRES],
  ["postgresql", POSTGRES],
  ["mysql", MARIADB],
  ["mariadb", MARIADB],
]);

export interface UrlFields {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
}

export const EMPTY_FIELDS: UrlFields = { host: "", port: "", user: "", password: "", database: "" };

/**
 * Split a pasted URL into the discrete fields, detecting the engine from the
 * scheme. `null` when it isn't parseable yet — the caller keeps the raw text
 * and waits; half a paste is not an error.
 */
export function fieldsFromUrl(raw: string): { engine: ConnectEngine; fields: UrlFields } | null {
  const scheme = /^([a-z][a-z0-9+]*):\/\//i.exec(raw.trim())?.[1]?.toLowerCase();
  const engine = scheme === undefined ? undefined : SCHEME_TO_ENGINE.get(scheme);
  if (engine === undefined) return null;
  const parsed = Result.try({
    // `new URL` rejects some driver schemes; normalising to https keeps the
    // authority parsing and costs nothing, since only components are read.
    try: () => new URL(raw.trim().replace(/^[a-z][a-z0-9+]*:\/\//i, "https://")),
    catch: () => null,
  });
  if (parsed.isErr()) return null;
  const u = parsed.value;
  return {
    engine,
    fields: {
      host: u.hostname,
      port: u.port,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: decodeURIComponent(u.pathname.replace(/^\//, "")),
    },
  };
}

/** Assemble the URL the server will store. Empty when the form has no host. */
export function urlFromFields(engine: ConnectEngine, f: UrlFields): string {
  if (f.host.trim() === "") return "";
  const auth =
    f.user === "" ? "" : `${encodeURIComponent(f.user)}:${encodeURIComponent(f.password)}@`;
  const port = f.port.trim() === "" ? engine.port : f.port.trim();
  const db = f.database.trim() === "" ? "" : `/${encodeURIComponent(f.database.trim())}`;
  return `${engine.scheme}://${auth}${f.host.trim()}:${port}${db}`;
}
