import { describe, expect, test } from "bun:test";

import { isTrustedOrigin } from "../origin";

const ALLOWED = ["https://deploy.example.com"];

describe("isTrustedOrigin", () => {
  test("accepts a configured origin", () => {
    expect(isTrustedOrigin("https://deploy.example.com", ALLOWED)).toBe(true);
  });

  test("accepts a same-origin upgrade that isn't enumerated", () => {
    // The case that broke the terminal: an install reached at its control-plane
    // domain while CORS_ORIGIN still held only the install-time IP. better-auth
    // already accepted this, so the app worked and the terminal alone 403'd.
    expect(isTrustedOrigin("https://other.example.com", ALLOWED, "other.example.com")).toBe(true);
    expect(isTrustedOrigin("http://10.0.0.4:3000", ALLOWED, "10.0.0.4:3000")).toBe(true);
  });

  test("rejects a cross-site origin even when a Host is present", () => {
    // The attack this guard exists for: attacker page, our Host.
    expect(isTrustedOrigin("https://evil.example.net", ALLOWED, "deploy.example.com")).toBe(false);
  });

  test("allows a MISSING Origin: that is a non-browser client, not the threat", () => {
    // `otd exec` upgrades from Node/Bun, which send no Origin at all, so
    // rejecting absent meant the CLI could never open a shell on any machine
    // (od-v7wb). Safe because the attack guarded against is cross-site
    // hijacking, which a browser cannot mount without sending Origin — and
    // because this upgrade carries no ambient credentials to ride, only a
    // single-use IP-bound ticket.
    expect(isTrustedOrigin(null, ALLOWED, "deploy.example.com")).toBe(true);
    expect(isTrustedOrigin(undefined, ALLOWED)).toBe(true);
  });

  test("still rejects a PRESENT but untrustworthy Origin", () => {
    // The distinction the fix turns on. An empty header, or the literal "null"
    // an opaque/sandboxed origin serializes to, is a browser telling us where
    // it came from and that the answer is untrustworthy. That is not the same
    // as no browser at all.
    expect(isTrustedOrigin("", ALLOWED, "deploy.example.com")).toBe(false);
    expect(isTrustedOrigin("   ", ALLOWED, "deploy.example.com")).toBe(false);
    expect(isTrustedOrigin("null", ALLOWED, "deploy.example.com")).toBe(false);
    expect(isTrustedOrigin("NULL", ALLOWED, "deploy.example.com")).toBe(false);
  });

  test("the cross-site case is unaffected by allowing absent", () => {
    // The property that matters: relaxing absent must not relax anything a
    // real attacker controls. An attacker page always has an Origin.
    expect(isTrustedOrigin("https://evil.example.net", ALLOWED, "deploy.example.com")).toBe(false);
    expect(isTrustedOrigin("https://evil.example.net", ALLOWED, null)).toBe(false);
  });

  test("a malformed Origin is not same-origin", () => {
    expect(isTrustedOrigin("not-a-url", ALLOWED, "deploy.example.com")).toBe(false);
  });

  test("host comparison ignores case, and a missing Host can't grant trust", () => {
    expect(isTrustedOrigin("https://Deploy.Example.com", ALLOWED, "deploy.example.com")).toBe(true);
    expect(isTrustedOrigin("https://other.example.com", ALLOWED, null)).toBe(false);
  });

  test("port is part of the origin. A different port is not same-origin", () => {
    expect(isTrustedOrigin("http://10.0.0.4:3000", ALLOWED, "10.0.0.4:9999")).toBe(false);
  });
});
