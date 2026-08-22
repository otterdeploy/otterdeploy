import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vite-plus/test";

import { CollectionNotice } from "./collection-notice";

/** Everything healthy and busy; each test turns one thing off. */
const healthy = {
  sinkConfigured: true,
  collecting: true,
  geoAvailable: true,
  hasHosts: true,
  requests: 1_000,
};

function render(over: Partial<typeof healthy> = {}) {
  return renderToStaticMarkup(<CollectionNotice {...healthy} {...over} />);
}

describe("CollectionNotice", () => {
  // The bug this page had: an install with EDGE_LOG_SINK unset records nothing,
  // ever, and was told "No traffic recorded in this window" — blaming the range
  // for a condition no range could fix.
  it("says collection is off rather than blaming the window", () => {
    const out = render({ sinkConfigured: false, requests: 0, hasHosts: false });
    expect(out).toContain("Traffic collection is off");
    expect(out).toContain("EDGE_LOG_SINK");
    // The distinction is the whole point, so it has to be stated outright.
    expect(out).toContain("no window would have data");
  });

  // startEdgeAnalytics refuses to enable when its day-row seed fails, so the
  // sink can be configured while nothing rolls up. That was silent.
  it("separates 'configured' from 'actually running'", () => {
    const out = render({ collecting: false, requests: 0 });
    expect(out).toContain("not running");
    expect(out).not.toContain("Traffic collection is off");
  });

  it("prefers the sink fault over the rollup fault when both are broken", () => {
    // Nothing can roll up if nothing is arriving; naming the downstream symptom
    // first would send the operator to the wrong place.
    const out = render({ sinkConfigured: false, collecting: false });
    expect(out).toContain("Traffic collection is off");
    expect(out).not.toContain("not running");
  });

  it("tells a healthy install with no domains what unblocks it", () => {
    const out = render({ hasHosts: false, requests: 0 });
    expect(out).toContain("No public domains yet");
    expect(out).toContain("Collection is running");
  });

  // A quiet install is not a fault, so it gets a line rather than a card.
  it("does not raise a card for a running install with no traffic yet", () => {
    const out = render({ requests: 0 });
    expect(out).toContain("No requests in this window yet");
    expect(out).not.toContain("ring-foreground/10");
  });

  it("says nothing at all when traffic is arriving and geo works", () => {
    expect(render()).toBe("");
  });

  it("explains an empty map only once there is traffic to place", () => {
    // Apostrophes come back HTML-escaped from renderToStaticMarkup, so match
    // on a fragment without one.
    expect(render({ geoAvailable: false })).toContain("visitor countries");
    // Before any traffic, the missing map is not the operator's problem.
    expect(render({ geoAvailable: false, requests: 0 })).not.toContain("GeoIP");
  });
});
