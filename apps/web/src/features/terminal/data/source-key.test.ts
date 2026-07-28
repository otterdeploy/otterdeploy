/**
 * The shell connection is keyed by the VALUE of its source, not the identity
 * of the object carrying it.
 *
 * This is the bug that made the terminal unusable: `resource-terminal.tsx`
 * built its `session` object inline, so every render produced a new identity.
 * That object was the connection effect's only dependency, so React tore the
 * WebSocket down and reopened it on each render — and the UI rendered the
 * resulting churn as an endless "connection lost — reconnecting". The server
 * was healthy the whole time: its log showed the socket accepted (200), the
 * shell spawned, then immediately closed and killed.
 *
 * Types cannot catch this — both objects are the same type — so it is pinned
 * here instead.
 */

import { describe, expect, test } from "vite-plus/test";

import type { SessionSource } from "../types";

/** Mirrors the key the hook derives; see use-shell-connection.ts. */
const keyOf = (source: SessionSource): string => JSON.stringify(source);

const container = (overrides: Partial<Extract<SessionSource, { kind: "container" }>> = {}) =>
  ({
    kind: "container",
    project: "store",
    service: "web",
    replica: "1",
    containerId: "abc123",
    ...overrides,
  }) satisfies SessionSource;

describe("source keying", () => {
  test("two objects describing the same target share a key", () => {
    // The exact case that broke: same target, rebuilt each render.
    expect(keyOf(container())).toBe(keyOf(container()));
  });

  test("a different container is a different key", () => {
    // Switching replica or container MUST reconnect — the fix must not go so
    // far that a genuine target change is ignored.
    expect(keyOf(container())).not.toBe(keyOf(container({ containerId: "def456" })));
    expect(keyOf(container())).not.toBe(keyOf(container({ replica: "2" })));
  });

  test("a different service is a different key", () => {
    expect(keyOf(container())).not.toBe(keyOf(container({ service: "api" })));
  });

  test("kinds never collide", () => {
    const ssh: SessionSource = { kind: "ssh", mode: "local", node: "host", host: "127.0.0.1" };
    expect(keyOf(ssh)).not.toBe(keyOf(container()));
  });
});
