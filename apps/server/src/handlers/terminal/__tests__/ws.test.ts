/**
 * od-5j8.9 — /pty WebSocket upgrade: Origin validation + single-use ticket.
 *
 * These exercise the REAL `terminalWebSocketHandler` over HTTP (Hono's
 * `app.request`), but only scenarios that are rejected before the handler
 * calls `upgradeWebSocket` — a genuine upgrade needs a live Bun server socket
 * that `app.request()` can't provide. That's every scenario this file needs:
 * origin checks and ticket rejection both happen strictly before the upgrade
 * call (see ../ws.ts), so a plain HTTP request through the same handler is a
 * faithful test of them.
 *
 * The ticket store is an in-memory double (see `memoryTicketStore` below) so
 * this file needs no Redis. That is not a convenience — it is the difference
 * between these tests passing and hanging in CI.
 */

import type { TicketStore } from "@otterdeploy/api/routers/terminal/tickets";

import {
  mintTerminalTicket,
  setTicketStoreForTests,
} from "@otterdeploy/api/routers/terminal/tickets";
import { env } from "@otterdeploy/env/server";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";

import { terminalWebSocketHandler } from "../ws";

const TRUSTED_ORIGIN = env.CORS_ORIGIN[0] ?? "http://localhost:3001";

/**
 * In-memory stand-in for the ticket store.
 *
 * These tests are about the UPGRADE HANDLER's rejection paths, not about Redis
 * — but every path that inspects a ticket goes through the store, so without a
 * double they opened a real connection. The CI `test` job has no Redis service
 * by design (only `integration` gets containers, see ci.yml), so those three
 * tests hung ~5s and failed on timeout, passing locally only because a
 * developer happens to have compose running.
 *
 * Honours the same two operations the real client does, with the semantics the
 * production code actually depends on:
 *   SET … NX  → null when the key already exists, never a silent overwrite.
 *   GETDEL    → returns the value AND removes it in one step, which is what
 *               makes a ticket single-use. Getting this wrong would make the
 *               replay test pass for the wrong reason.
 *
 * TTL is accepted and ignored: expiry is Redis behaviour, and the test that
 * covers it lives in the API package's security suite against a real server.
 */
function memoryTicketStore(): TicketStore {
  const entries = new Map<string, string>();
  return {
    set: (key, value, _nx, _ex, _ttl) =>
      Promise.resolve(entries.has(key) ? null : (entries.set(key, value), "OK")),
    send: (command, args) => {
      if (command !== "GETDEL") throw new Error(`unexpected redis command: ${command}`);
      const key = args[0] ?? "";
      const value = entries.get(key);
      entries.delete(key);
      return Promise.resolve(value ?? null);
    },
  };
}

beforeAll(() => setTicketStoreForTests(memoryTicketStore()));
// Restore the real lazily-created client so a later suite in the same process
// cannot inherit this double.
afterAll(() => setTicketStoreForTests(null));

function app() {
  const a = new Hono();
  a.get("/pty", terminalWebSocketHandler);
  return a;
}

function upgradeRequest(opts: { origin?: string; ticket?: string }) {
  const url = new URL("http://server.test/pty");
  if (opts.ticket !== undefined) url.searchParams.set("ticket", opts.ticket);
  const headers = new Headers({ upgrade: "websocket", connection: "Upgrade" });
  if (opts.origin !== undefined) headers.set("origin", opts.origin);
  return app().request(url, { headers });
}

describe("[od-5j8.9] /pty Origin validation", () => {
  test("a foreign Origin is rejected before any ticket is inspected", async () => {
    const res = await upgradeRequest({ origin: "https://evil.example.com", ticket: "whatever" });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { message: string };
    expect(body.message).toMatch(/origin/i);
  });

  test("a missing Origin is rejected — every browser sends one on a WS handshake", async () => {
    const res = await upgradeRequest({ ticket: "whatever" });
    expect(res.status).toBe(403);
  });

  test("the trusted control-plane origin passes the Origin gate (fails later, on the ticket, not the origin)", async () => {
    const res = await upgradeRequest({ origin: TRUSTED_ORIGIN, ticket: "not-a-real-ticket" });
    // Origin accepted; ticket is bogus so this is a 401 from the ticket
    // check, never a 403 from the origin check.
    expect(res.status).toBe(401);
  });
});

describe("[od-5j8.9] /pty requires a single-use ticket — no cookie/ambient fallback", () => {
  test("no ticket at all is rejected (cookie-only upgrades are dead)", async () => {
    const res = await upgradeRequest({ origin: TRUSTED_ORIGIN });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { message: string };
    expect(body.message).toMatch(/ticket/i);
  });

  test("a garbage ticket is rejected", async () => {
    const res = await upgradeRequest({ origin: TRUSTED_ORIGIN, ticket: "not-a-real-ticket" });
    expect(res.status).toBe(401);
  });

  test("a ticket already consumed once (a prior open, or a replay) is rejected on the next attempt", async () => {
    const minted = await mintTerminalTicket({
      userId: "user_1",
      organizationId: "org_1",
      target: { kind: "host" },
      clientIp: null,
    });
    // Burn it directly — equivalent to "already used to open a session".
    const { consumeTerminalTicket } = await import("@otterdeploy/api/routers/terminal/tickets");
    const first = await consumeTerminalTicket(minted.token, { clientIp: null });
    expect(first.isOk()).toBe(true);

    const res = await upgradeRequest({ origin: TRUSTED_ORIGIN, ticket: minted.token });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { message: string };
    expect(body.message).toMatch(/already been used|invalid|expired/i);
  });

  test("a non-upgrade GET falls through untouched (health checks etc. aren't caught by the gate)", async () => {
    const res = await app().request("http://server.test/pty");
    // No `Upgrade: websocket` header ⇒ handler calls next(); with nothing
    // else mounted on this throwaway app, Hono's default 404 comes back —
    // proof the gate didn't intercept a non-WS request.
    expect(res.status).toBe(404);
  });
});
