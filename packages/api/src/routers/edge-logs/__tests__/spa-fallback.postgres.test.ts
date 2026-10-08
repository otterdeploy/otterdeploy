/**
 * A scanner probe answered by a single-page app's index page is
 * not a leaked file.
 *
 * The live tour's Edge page tagged `/.env`, `/.git/config` and `/config.json`
 * SECRET-FILE / CONFIG-FILE with status 200: every one was the SPA's
 * `index.html` fallback, the same 781 bytes the host served for `/`. The access
 * log does not record a content type, but it does record the size, and the
 * feed's `spaFallback` column compares it with the host's own root document.
 * Driven against a real Postgres because the whole fix is a correlated query.
 */
import { db } from "@otterdeploy/db";
import { edgeLog } from "@otterdeploy/db/schema/edge-log";
import { Temporal } from "@otterdeploy/shared/temporal";
import { inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { ensureEdgeLogTable } from "../../../edge-logs/partition";
import { edgeAccessExtraSelect } from "../access-table";

const SPA = "spa.spa-fallback.test";
const STATIC = "static.spa-fallback.test";
const INDEX_BYTES = 781;

function at(minutesAgo: number): Date {
  // drizzle's timestamp column takes a Date: the library seam.
  return new Date(Temporal.Now.instant().epochMilliseconds - minutesAgo * 60_000);
}

function row(host: string, path: string, status: number, resBytes: number, minutesAgo: number) {
  return {
    ts: at(minutesAgo),
    method: "GET",
    host,
    path,
    status,
    latencyMs: 1,
    clientIp: "203.0.113.7",
    userAgent: "scanner",
    referer: "-",
    reqBytes: 0,
    resBytes,
    headers: {},
  };
}

async function fallbackByPath(host: string): Promise<Map<string, boolean>> {
  const rows = await db
    .select({
      path: edgeLog.path,
      status: edgeLog.status,
      fallback: edgeAccessExtraSelect.spaFallback,
    })
    .from(edgeLog)
    .where(inArray(edgeLog.host, [host]));
  return new Map(rows.map((r) => [`${r.status} ${r.path}`, r.fallback === true]));
}

beforeAll(async () => {
  await ensureEdgeLogTable();
  await db.insert(edgeLog).values([
    // The SPA: `/` is its index page, and every probe gets the same bytes back.
    row(SPA, "/", 200, INDEX_BYTES, 30),
    row(SPA, "/.env", 200, INDEX_BYTES, 5),
    row(SPA, "/.git/config", 200, INDEX_BYTES, 4),
    row(SPA, "/config.json", 200, INDEX_BYTES, 3),
    // A probe that drew a redirect is not a fallback either: nothing was served.
    row(SPA, "/.aws/credentials", 308, 0, 2),
    // Ordinary traffic of the same size is never a probe.
    row(SPA, "/about", 200, INDEX_BYTES, 1),
    // A host that really serves the file: its `/.env` is not the root document.
    row(STATIC, "/", 200, 4_096, 30),
    row(STATIC, "/.env", 200, 120, 5),
  ]);
});

describe("spaFallback", () => {
  it("marks a probe answered with the host's own index page", async () => {
    const byPath = await fallbackByPath(SPA);
    expect(byPath.get("200 /.env")).toBe(true);
    expect(byPath.get("200 /.git/config")).toBe(true);
    expect(byPath.get("200 /config.json")).toBe(true);
  });

  it("leaves a probe that got something else flagged as served", async () => {
    const byPath = await fallbackByPath(STATIC);
    expect(byPath.get("200 /.env")).toBe(false);
  });

  it("only speaks about probes that drew a 2xx body", async () => {
    const byPath = await fallbackByPath(SPA);
    expect(byPath.get("308 /.aws/credentials")).toBe(false);
    expect(byPath.get("200 /about")).toBe(false);
    expect(byPath.get("200 /")).toBe(false);
  });
});
