import { call, ORPCError, os } from "@orpc/server";
import { idSchema } from "@otterdeploy/shared/id";
/**
 * A member removed while a stream is open stops receiving it.
 *
 * The org-scoped guard checks membership when a call starts; a streaming call
 * (event stream, log tail, over HTTP or the live socket) then ran for as long
 * as the tab stayed open. These pin the re-check: throttled per frame, ends
 * the stream FORBIDDEN, finalizes the inner stream, and leaves API keys alone.
 */
import { Result } from "better-result";
import { createRequestLogger } from "evlog";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { Context } from "../../context";

const isOrgMember = vi.fn(async (_userId: string, _orgId: string) => true);
vi.mock("../org-member", () => ({ isOrgMember }));

const { guardStreamMembership } = await import("../stream-membership");
const { orgScopedMiddleware } = await import("../org-scope-middleware");

beforeEach(() => {
  isOrgMember.mockReset();
  isOrgMember.mockResolvedValue(true);
});

/** A stream that records whether it was finalized. */
function counter(limit: number) {
  const state = { finalized: false };
  async function* stream() {
    try {
      for (let i = 1; i <= limit; i++) yield i;
    } finally {
      state.finalized = true;
    }
  }
  return { state, stream: stream() };
}

async function nextError(iterator: AsyncIterator<unknown>): Promise<unknown> {
  const result = await Result.tryPromise({ try: () => iterator.next(), catch: (e) => e });
  expect(result.isErr()).toBe(true);
  return result.isErr() ? result.error : undefined;
}

describe("guardStreamMembership", () => {
  it("passes frames through without a query inside the recheck window", async () => {
    let clock = 0;
    const isMember = vi.fn(async () => true);
    const guarded = guardStreamMembership(counter(3).stream, {
      userId: "u",
      organizationId: "o",
      recheckMs: 1000,
      isMember,
      now: () => clock,
    });
    clock = 500;
    expect(await guarded.next()).toEqual({ done: false, value: 1 });
    expect(await guarded.next()).toEqual({ done: false, value: 2 });
    expect(isMember).not.toHaveBeenCalled();
  });

  it("ends the stream FORBIDDEN once the member table no longer has the user", async () => {
    let clock = 0;
    let member = true;
    const { state, stream } = counter(10);
    const guarded = guardStreamMembership(stream, {
      userId: "u",
      organizationId: "o",
      recheckMs: 1000,
      isMember: async () => member,
      now: () => clock,
    });
    expect(await guarded.next()).toEqual({ done: false, value: 1 });
    clock = 1500;
    expect(await guarded.next()).toEqual({ done: false, value: 2 });
    member = false;
    clock = 3000;
    const error = await nextError(guarded);
    expect(error).toBeInstanceOf(ORPCError);
    expect(error).toMatchObject({ code: "FORBIDDEN", status: 403 });
    // The inner stream is finalized (its subscription released), and nothing
    // more is delivered.
    expect(state.finalized).toBe(true);
    expect(await guarded.next()).toEqual({ done: true, value: undefined });
  });
});

function sessionContext(): Context {
  const session = {
    kind: "session" as const,
    headers: new Headers(),
    user: {
      id: "user_member",
      email: "member@example.test",
      isInstallAdmin: false,
      twoFactorEnabled: false,
    },
    session: { activeOrganizationId: "org_a" },
  };
  return {
    actor: session,
    session,
    apiKey: null,
    apiKeyRateLimited: null,
    activeOrganizationId: idSchema.organization.parse("org_a"),
    headers: new Headers(),
    log: createRequestLogger({ method: "TEST", path: "/rpc" }),
    broadcast: () => {},
  };
}

function apiKeyContext(): Context {
  const apiKey = {
    kind: "api-key" as const,
    id: "key",
    permissions: null,
    organizationId: "org_a",
  };
  return { ...sessionContext(), actor: apiKey, session: null, apiKey };
}

const streaming = os
  .$context<Context>()
  .use(orgScopedMiddleware)
  .handler(async function* () {
    for (let i = 1; i <= 100; i++) yield i;
  });

describe("org-scoped streaming procedures re-check membership", () => {
  it("a session removed mid-stream is cut off with FORBIDDEN", async () => {
    let clock = 0;
    const now = vi.spyOn(performance, "now").mockImplementation(() => clock);
    try {
      const output = await call(streaming, undefined, { context: sessionContext() });
      if (!(Symbol.asyncIterator in output)) throw new Error("expected a stream");
      expect(await output.next()).toEqual({ done: false, value: 1 });
      isOrgMember.mockResolvedValue(false);
      clock = 60_000;
      expect(await nextError(output)).toMatchObject({ code: "FORBIDDEN" });
      expect(isOrgMember).toHaveBeenLastCalledWith("user_member", "org_a");
    } finally {
      now.mockRestore();
    }
  });

  it("an API-key stream is left alone (its organization is the key's own)", async () => {
    let clock = 0;
    const now = vi.spyOn(performance, "now").mockImplementation(() => clock);
    try {
      const output = await call(streaming, undefined, { context: apiKeyContext() });
      if (!(Symbol.asyncIterator in output)) throw new Error("expected a stream");
      isOrgMember.mockResolvedValue(false);
      clock = 60_000;
      expect(await output.next()).toEqual({ done: false, value: 1 });
      expect(isOrgMember).not.toHaveBeenCalled();
    } finally {
      now.mockRestore();
    }
  });
});
