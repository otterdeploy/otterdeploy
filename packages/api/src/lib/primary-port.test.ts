/**
 * od-8kqp: the manifest diff and the write path must read an omitted
 * `primary` the same way.
 *
 * The bug this pins is not the rule itself but the DISAGREEMENT. The write
 * path promoted the first HTTP port; the diff read an omitted flag as
 * `isPrimary: false`. So a manifest that legally omits `primary` proposed a
 * demotion, apply promoted it straight back, and the identical change was
 * re-proposed on every diff, forever. Round-tripping a manifest also silently
 * demoted the primary port, which breaks routing.
 *
 * The convergence test at the bottom is the one that would have caught it.
 */
import { describe, expect, it } from "vite-plus/test";

import { withPromotedPrimary } from "./primary-port";

const http = (isPrimary = false) => ({ appProtocol: "http" as const, isPrimary });
const tcp = (isPrimary = false) => ({ appProtocol: "tcp" as const, isPrimary });

describe("withPromotedPrimary", () => {
  it("promotes the first HTTP port when none is flagged", () => {
    const out = withPromotedPrimary([http(), http()]);
    expect(out.map((p) => p.isPrimary)).toEqual([true, false]);
  });

  it("skips leading non-HTTP ports when choosing the first", () => {
    const out = withPromotedPrimary([tcp(), http()]);
    expect(out.map((p) => p.isPrimary)).toEqual([false, true]);
  });

  it("leaves an explicit choice alone", () => {
    const out = withPromotedPrimary([http(), http(true)]);
    expect(out.map((p) => p.isPrimary)).toEqual([false, true]);
  });

  it("promotes nothing when there is no HTTP port", () => {
    // A TCP-only service has no primary. Inventing one would route traffic at
    // a port that cannot serve it.
    const out = withPromotedPrimary([tcp(), tcp()]);
    expect(out.map((p) => p.isPrimary)).toEqual([false, false]);
  });

  it("handles an empty list", () => {
    expect(withPromotedPrimary([])).toEqual([]);
  });

  it("does not mutate its input", () => {
    const input = [http(), http()];
    withPromotedPrimary(input);
    expect(input.map((p) => p.isPrimary)).toEqual([false, false]);
  });

  it("converges: applying the rule twice changes nothing", () => {
    // THE property that was broken. The diff normalizes the desired ports and
    // apply normalizes them again on write; if those two disagree the change
    // is re-proposed forever. Idempotence is what makes the loop terminate.
    const once = withPromotedPrimary([http(), tcp()]);
    expect(withPromotedPrimary(once)).toEqual(once);
  });
});
