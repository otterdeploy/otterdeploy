import type { DataConnectionId } from "@otterdeploy/shared/id";

import { createId, ID_PREFIX } from "@otterdeploy/shared/id";
import { describe, expect, it } from "vite-plus/test";

import {
  closeSession,
  evictIdle,
  listSessions,
  liveSession,
  openSession,
  ownerOf,
  sessionKey,
} from "./session";

const org = createId(ID_PREFIX.organization);
const minted = new Map<number, DataConnectionId>();
/** A stable connection id per index, so two opens of `conn(1)` name one target. */
const conn = (n: number): DataConnectionId => {
  const existing = minted.get(n);
  if (existing) return existing;
  const id = createId(ID_PREFIX.dataConnection);
  minted.set(n, id);
  return id;
};

describe("workbench sessions", () => {
  it("is keyed by owner, organization and target, so opening twice joins", async () => {
    const target = { kind: "connection" as const, connectionId: conn(1) };
    const a = await openSession({ owner: "user_a", organizationId: org, target });
    const b = await openSession({ owner: "user_a", organizationId: org, target });
    expect(a.isOk() && b.isOk() && a.value === b.value).toBe(true);
    expect(
      liveSession(sessionKey({ owner: "user_a", organizationId: org, target })),
    ).not.toBeNull();
    // Someone else's key never resolves to it.
    expect(liveSession(sessionKey({ owner: "user_b", organizationId: org, target }))).toBeNull();
    expect(closeSession(sessionKey({ owner: "user_a", organizationId: org, target }))).toBe(true);
    expect(listSessions("user_a", org)).toHaveLength(0);
  });

  it("reaps sessions idle past the limit and nothing else", async () => {
    const fresh = { kind: "connection" as const, connectionId: conn(2) };
    const stale = { kind: "connection" as const, connectionId: conn(3) };
    await openSession({ owner: "user_c", organizationId: org, target: fresh });
    const old = await openSession({ owner: "user_c", organizationId: org, target: stale });
    if (old.isOk()) old.value.lastUsedAt -= 11 * 60_000;
    expect(evictIdle(Date.now())).toBe(1);
    expect(listSessions("user_c", org).map((s) => s.target)).toEqual([fresh]);
    closeSession(sessionKey({ owner: "user_c", organizationId: org, target: fresh }));
  });

  it("caps an owner at five live sessions by closing the least recently used", async () => {
    for (let n = 10; n < 16; n += 1) {
      await openSession({
        owner: "user_d",
        organizationId: org,
        target: { kind: "connection", connectionId: conn(n) },
      });
    }
    const live = listSessions("user_d", org);
    expect(live).toHaveLength(5);
    expect(
      live.some((s) => s.target.kind === "connection" && s.target.connectionId === conn(10)),
    ).toBe(false);
    for (const s of live) closeSession(s.key);
  });

  it("pools API-key callers under one owner", () => {
    expect(ownerOf(null)).toBe("api-key");
  });
});
