import { describe, expect, it } from "vite-plus/test";

import { decisionIdentity, rowIdentity } from "../decision-identity";

/**
 * How a live decision is matched to a row we already have.
 *
 * This is the whole correctness of the recorder: match too loosely and two
 * different bans collapse into one row; match too strictly and every poll
 * "ends" the decision it just saw and opens a new one, turning a single
 * 30-minute ban into thirty one-minute rows.
 */
describe("decisionIdentity", () => {
  const base = {
    id: null,
    origin: "crowdsec",
    type: "ban",
    scope: "Ip",
    value: "1.2.3.4",
    duration: "30m",
    scenario: "crowdsecurity/ssh-slow-bf",
    country: null,
    asNumber: null,
    asName: null,
    eventsCount: null,
    createdAt: null,
  };

  it("uses CrowdSec's own id when it gave us one", () => {
    expect(decisionIdentity({ ...base, id: 42 })).toBe("id:42");
  });

  it("is stable across polls: the same live decision matches itself", () => {
    // The duration counts DOWN between polls (30m → 29m). Including it in the
    // key would make every poll see a new decision and close the old one.
    const first = decisionIdentity({ ...base, duration: "30m" });
    const second = decisionIdentity({ ...base, duration: "12m" });
    expect(first).toBe(second);
  });

  it("separates two scenarios banning the same IP", () => {
    // A host SSH ban and an HTTP ban on one address are two facts, and one
    // can expire while the other stands.
    const ssh = decisionIdentity(base);
    const http = decisionIdentity({ ...base, scenario: "crowdsecurity/http-probing" });
    expect(ssh).not.toBe(http);
  });

  it("separates the same scenario from different origins", () => {
    // Locally detected vs arrived in an imported list: unblocking one must
    // not read as unblocking the other.
    const local = decisionIdentity(base);
    const imported = decisionIdentity({ ...base, origin: "lists" });
    expect(local).not.toBe(imported);
  });

  it("separates an IP from a range that contains it", () => {
    const ip = decisionIdentity(base);
    const range = decisionIdentity({ ...base, scope: "Range", value: "1.2.3.0/24" });
    expect(ip).not.toBe(range);
  });

  it("prefers the id over the composite when both are available", () => {
    // Two decisions can share every composite field and still be distinct
    // rows in CrowdSec (a re-ban after an expiry). The id is the truth.
    const a = decisionIdentity({ ...base, id: 1 });
    const b = decisionIdentity({ ...base, id: 2 });
    expect(a).not.toBe(b);
  });

  it("derives the same key from a stored row as from a live decision", () => {
    // The two sides of the diff. If they ever disagree, nothing matches and
    // every poll re-opens every decision.
    const live = decisionIdentity(base);
    const stored = rowIdentity({
      lapiId: null,
      value: base.value,
      scope: base.scope,
      scenario: base.scenario,
      origin: base.origin,
    });
    expect(stored).toBe(live);
  });

  it("agrees on the id path too", () => {
    expect(rowIdentity({ lapiId: 42, value: "x", scope: "Ip", scenario: "s", origin: "o" })).toBe(
      decisionIdentity({ ...base, id: 42 }),
    );
  });
});
