/**
 * Every streaming procedure says where it runs.
 *
 * The dashboard routes the live-socket list over one WebSocket per tab and
 * everything else over plain HTTP. A new event-iterator procedure that is in
 * neither list would silently fall back to holding an HTTP connection open per
 * subscriber, the exact budget leak this list exists to prevent, so the router
 * walk below fails until the new stream is classified.
 */
import { getEventIteratorSchemaDetails } from "@orpc/contract";
import { isProcedure } from "@orpc/server";
import { describe, expect, test } from "vite-plus/test";

import { appRouter } from ".";
import {
  LIVE_SOCKET_PROCEDURES,
  REQUEST_BOUND_STREAMS,
  isLiveSocketPathname,
  isLiveSocketProcedure,
} from "./live-socket";

const streams: string[] = [];
(function walk(node: unknown, path: readonly string[]) {
  if (isProcedure(node)) {
    if (getEventIteratorSchemaDetails(node["~orpc"].outputSchema)) streams.push(path.join("."));
    return;
  }
  if (node === null || typeof node !== "object") return;
  for (const [key, child] of Object.entries(node)) walk(child, [...path, key]);
})(appRouter, []);

describe("live socket classification", () => {
  test("the router walk found the streams", () => {
    expect(streams).toContain("events.orgStream");
    expect(streams).toContain("project.logs.tail");
  });

  test("every streaming procedure is classified, exactly once", () => {
    const classified = [...LIVE_SOCKET_PROCEDURES, ...REQUEST_BOUND_STREAMS];
    expect(streams.toSorted()).toEqual(classified.toSorted());
    expect(new Set(classified).size).toBe(classified.length);
  });

  test("a request-bound stream never rides the socket", () => {
    for (const name of REQUEST_BOUND_STREAMS) {
      expect(isLiveSocketProcedure(name.split("."))).toBe(false);
    }
  });

  test("RPC pathnames match on the whole procedure path", () => {
    expect(isLiveSocketPathname("/rpc/events/orgStream")).toBe(true);
    expect(isLiveSocketPathname("/rpc/project/logs/tail")).toBe(true);
    expect(isLiveSocketPathname("/rpc/project/update")).toBe(false);
    expect(isLiveSocketPathname("/rpc/events/orgStream/extra")).toBe(false);
    expect(isLiveSocketPathname("/events/orgStream")).toBe(false);
  });
});
