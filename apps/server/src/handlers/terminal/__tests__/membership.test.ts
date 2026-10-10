import type { ServerWebSocket } from "bun";

/**
 * A terminal session ends once its user leaves the organization.
 *
 * The /pty ticket is minted by an org-scoped call, so membership was checked
 * exactly once; the shell then lived as long as the tab. These drive the real
 * socket events (`ptyEvents`) with a fake shell and a fake member table.
 */
import { Result } from "better-result";
import { WSContext } from "hono/ws";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { PtyBackend } from "../pty";

const isOrgMember = vi.fn(async (_userId: string, _orgId: string) => true);
vi.mock("@otterdeploy/api/authz/org-member", () => ({ isOrgMember }));
vi.mock("@otterdeploy/api/audit/terminal", () => ({
  recordTerminalShellAudit: vi.fn(async () => undefined),
}));

const { ptyEvents } = await import("../ws");
const { watchTerminalMembership } = await import("../membership");

const RECHECK_MS = 20;
const claims = {
  userId: "user_member",
  organizationId: "org_a",
  target: { kind: "container" as const, id: "c1" },
  clientIp: null,
};

const backend = { write: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
const deps = {
  startShell: async () => Result.ok<PtyBackend, never>(backend),
  membershipRecheckMs: RECHECK_MS,
};

function fakeSocket() {
  const close = vi.fn();
  const raw: Pick<ServerWebSocket<unknown>, "send" | "getBufferedAmount"> = {
    send: () => 1,
    getBufferedAmount: () => 0,
  };
  const ws = new WSContext<ServerWebSocket<unknown>>({
    send: () => {},
    close,
    // The shell only ever calls these two; Object.create(null) is how a
    // partial double satisfies the full ServerWebSocket type without a cast.
    raw: Object.assign(Object.create(null), raw),
    readyState: 1,
  });
  return { ws, close };
}

/** onOpen is declared void-returning but is async here: wait for the shell. */
async function open(events: ReturnType<typeof ptyEvents>, ws: WSContext<ServerWebSocket<unknown>>) {
  const opened: unknown = events.onOpen?.(new Event("open"), ws);
  if (opened instanceof Promise) await opened;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  isOrgMember.mockReset();
  isOrgMember.mockResolvedValue(true);
  backend.dispose.mockReset();
});

describe("the /pty session re-checks membership", () => {
  it("closes the socket and disposes the shell once the user is removed", async () => {
    const events = ptyEvents(claims, { kind: "container", id: "c1" }, deps);
    const { ws, close } = fakeSocket();
    await open(events, ws);

    await sleep(RECHECK_MS * 3);
    expect(isOrgMember).toHaveBeenCalledWith("user_member", "org_a");
    expect(close).not.toHaveBeenCalled();

    isOrgMember.mockResolvedValue(false);
    await sleep(RECHECK_MS * 3);
    expect(backend.dispose).toHaveBeenCalled();
    expect(close).toHaveBeenCalledWith(1000, "session ended");
    events.onClose?.(new CloseEvent("close"), ws);
  });

  it("stops checking once the socket closes", async () => {
    const events = ptyEvents(claims, { kind: "container", id: "c1" }, deps);
    const { ws } = fakeSocket();
    await open(events, ws);
    events.onClose?.(new CloseEvent("close"), ws);
    await sleep(RECHECK_MS * 3);
    expect(isOrgMember).not.toHaveBeenCalled();
  });

  it("a failed lookup is not a verdict: the session keeps running", async () => {
    const onRevoked = vi.fn();
    const stop = watchTerminalMembership({
      userId: "u",
      organizationId: "o",
      onRevoked,
      intervalMs: RECHECK_MS,
      isMember: async () => {
        throw new Error("connection terminated");
      },
    });
    await sleep(RECHECK_MS * 3);
    expect(onRevoked).not.toHaveBeenCalled();
    stop();
  });
});
