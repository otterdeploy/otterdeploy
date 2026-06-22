/**
 * MongoDB data-viewer engine. Mongo has no tables/SQL, so (like the Redis
 * viewer) it gets a native browser: list collections + counts, then page a
 * collection's documents. Only read operations are issued (find / skip / limit /
 * estimatedDocumentCount / getCollectionNames) and the collection name is the
 * only caller input — JSON-encoded into the eval source — so the viewer is
 * read-only by construction with no command-injection surface.
 *
 * Runs inside the database's task container via the same Docker exec channel the
 * backup engine + other viewers use (no overlay-network connection). Output is
 * Extended JSON (`EJSON.stringify`) wrapped in sentinels so we can pull our
 * payload out of any shell chatter.
 */
import { Docker } from "@otterdeploy/docker";

import { execCapture, findServiceContainerId } from "../../backups/exec";
import { buildContainerName } from "../project/views";
import {
  type DbConnInfo,
  QueryError,
  UnsupportedEngineError,
} from "./query";

/** Wraps the eval payload so we can extract it from mongosh's stdout. */
const S = "__OTTER_MONGO__";

export interface MongoCollection {
  name: string;
  count: number;
}

export interface MongoDocs {
  /** Each document as an Extended-JSON string (ObjectId/Date preserved). */
  docs: string[];
  /** True when another page exists (we fetched `limit + 1`). */
  hasMore: boolean;
}

async function withMongosh<T>(
  conn: DbConnInfo,
  fn: (run: (js: string) => Promise<string>) => Promise<T>,
): Promise<T> {
  if (conn.engine !== "mongodb") throw new UnsupportedEngineError(conn.engine);
  const docker = Docker.fromEnv();
  try {
    const serviceName = buildContainerName({
      engine: conn.engine,
      projectSlug: conn.projectSlug,
      resourceName: conn.resourceName,
    });
    const containerId = await findServiceContainerId(docker, serviceName);
    if (!containerId) {
      throw new QueryError(`mongodb container for ${serviceName} is not running`);
    }
    const run = async (js: string) => {
      const result = await execCapture(
        docker,
        containerId,
        [
          "mongosh",
          "--quiet",
          "-u",
          conn.username,
          "-p",
          conn.password,
          "--authenticationDatabase",
          "admin",
          conn.databaseName,
          "--eval",
          js,
        ],
        { allowNonZero: true },
      );
      if (result.exitCode !== 0) {
        throw new QueryError(result.stderr.trim() || result.stdout.trim() || "mongosh command failed");
      }
      const out = result.stdout;
      const start = out.indexOf(S);
      const end = out.lastIndexOf(S);
      if (start === -1 || end <= start) {
        throw new QueryError(out.trim() || "no output from mongosh");
      }
      return out.slice(start + S.length, end);
    };
    return await fn(run);
  } finally {
    docker.destroy();
  }
}

/** List the resource database's collections with an estimated doc count. */
export async function mongoCollections(
  conn: DbConnInfo,
): Promise<MongoCollection[]> {
  return withMongosh(conn, async (run) => {
    const raw = await run(
      `print("${S}" + EJSON.stringify(db.getCollectionNames().map(n => ` +
        `({ name: n, count: db.getCollection(n).estimatedDocumentCount() }))) + "${S}")`,
    );
    const parsed = JSON.parse(raw) as Array<{ name: string; count: number }>;
    return parsed.map((c) => ({ name: c.name, count: Number(c.count) || 0 }));
  });
}

/** Page through a collection's documents (read-only find). */
export async function mongoDocuments(
  conn: DbConnInfo,
  opts: { collection: string; limit: number; skip: number },
): Promise<MongoDocs> {
  return withMongosh(conn, async (run) => {
    // The collection name is JSON-encoded into the source, so it can't break out
    // of the string literal. Fetch one extra to detect a next page.
    const coll = JSON.stringify(opts.collection);
    const raw = await run(
      `print("${S}" + EJSON.stringify(db.getCollection(${coll}).find()` +
        `.skip(${opts.skip}).limit(${opts.limit + 1}).toArray()) + "${S}")`,
    );
    const parsed = JSON.parse(raw) as unknown[];
    const hasMore = parsed.length > opts.limit;
    return {
      docs: parsed.slice(0, opts.limit).map((d) => JSON.stringify(d, null, 2)),
      hasMore,
    };
  });
}
