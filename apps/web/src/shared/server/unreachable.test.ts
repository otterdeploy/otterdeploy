import { ORPCError } from "@orpc/client";
import { describe, expect, it } from "vite-plus/test";

import { isControlPlaneUnreachable } from "./unreachable";

describe("isControlPlaneUnreachable", () => {
  describe("an intermediary reporting the origin is gone", () => {
    it("matches the classic gateway statuses", () => {
      for (const status of [502, 503, 504]) {
        expect(isControlPlaneUnreachable(new ORPCError("BAD_GATEWAY", { status }))).toBe(true);
      }
    });

    it("matches Cloudflare's 52x family, which oRPC has no name for", () => {
      // Statuses outside oRPC's nineteen collapse to this code, whatever they
      // were. 521 is "Web Server Is Down" — exactly a cutover.
      const err = new ORPCError("MALFORMED_ORPC_ERROR_RESPONSE", { status: 521 });
      expect(isControlPlaneUnreachable(err)).toBe(true);
    });

    it("matches the malformed code even below the gateway floor", () => {
      // Nothing our API can produce: the body didn't parse as an oRPC error, so
      // whatever answered was not this server.
      const err = new ORPCError("MALFORMED_ORPC_ERROR_RESPONSE", { status: 451 });
      expect(isControlPlaneUnreachable(err)).toBe(true);
    });
  });

  describe("the server answering with a complaint", () => {
    it("leaves a 500 as a real error", () => {
      const err = new ORPCError("INTERNAL_SERVER_ERROR", { status: 500 });
      expect(isControlPlaneUnreachable(err)).toBe(false);
    });

    it("leaves 501 as a real error (it sits just under the floor)", () => {
      expect(isControlPlaneUnreachable(new ORPCError("NOT_IMPLEMENTED", { status: 501 }))).toBe(
        false,
      );
    });

    it("leaves ordinary client errors alone", () => {
      for (const [code, status] of [
        ["UNAUTHORIZED", 401],
        ["FORBIDDEN", 403],
        ["NOT_FOUND", 404],
        ["CONFLICT", 409],
      ] as const) {
        expect(isControlPlaneUnreachable(new ORPCError(code, { status }))).toBe(false);
      }
    });
  });

  describe("no HTTP exchange at all", () => {
    it("matches each engine's fetch-failure wording", () => {
      for (const message of [
        "Failed to fetch",
        "NetworkError when attempting to fetch resource.",
        "Load failed",
        "Network request failed",
      ]) {
        expect(isControlPlaneUnreachable(new TypeError(message))).toBe(true);
      }
    });

    it("does not swallow an unrelated TypeError from app code", () => {
      expect(isControlPlaneUnreachable(new TypeError("x.map is not a function"))).toBe(false);
    });
  });

  it("ignores plain errors and non-errors", () => {
    expect(isControlPlaneUnreachable(new Error("boom"))).toBe(false);
    expect(isControlPlaneUnreachable("Failed to fetch")).toBe(false);
    expect(isControlPlaneUnreachable(null)).toBe(false);
    expect(isControlPlaneUnreachable(undefined)).toBe(false);
  });
});
