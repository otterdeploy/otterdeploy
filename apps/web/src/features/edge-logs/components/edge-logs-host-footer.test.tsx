import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vite-plus/test";

import type { EdgeHostStat, EdgeLogsData } from "./edge-logs-constants";

import { HostFooter } from "./edge-logs-view-parts";

function stat(host: string, over: Partial<EdgeHostStat> = {}): EdgeHostStat {
  return { host, rps: 0, errorRate: 0, p50: 1, p95: 2, p99: 3, ...over };
}

function render(hostStats: EdgeHostStat[]) {
  const data: EdgeLogsData = { rows: [], histogram: [], hostStats, total: hostStats.length };
  return renderToStaticMarkup(<HostFooter data={data} />);
}

/** Host rows link the domain; the fold summary does not. */
function hostRowCount(markup: string) {
  return markup.split('href="https://').length - 1;
}

describe("HostFooter", () => {
  // The footer sits under the scrolling log table in the same flex column, so
  // an org with one preview host per open PR pushed the table off the screen.
  it("folds everything past the second host into one row", () => {
    const out = render([
      stat("a.example.com"),
      stat("b.example.com"),
      stat("c.example.com"),
      stat("d.example.com"),
    ]);
    expect(hostRowCount(out)).toBe(2);
    expect(out).toContain("+2 more hosts");
  });

  // Folding a single host trades a click for no height at all.
  it("does not fold when only one host would be hidden", () => {
    const out = render([stat("a.example.com"), stat("b.example.com"), stat("c.example.com")]);
    expect(hostRowCount(out)).toBe(3);
    expect(out).not.toContain("more hosts");
  });

  it("keeps the erroring host visible however it arrived in the payload", () => {
    const out = render([
      stat("quiet-1.example.com"),
      stat("quiet-2.example.com"),
      stat("quiet-3.example.com"),
      stat("broken.example.com", { errorRate: 0.292 }),
    ]);
    expect(out).toContain("broken.example.com");
    expect(out).toContain("29.2% err");
  });

  it("ranks a busy host above an idle one", () => {
    const out = render([
      stat("idle-1.example.com"),
      stat("idle-2.example.com"),
      stat("busy.example.com", { rps: 12 }),
      stat("idle-3.example.com"),
    ]);
    expect(out.indexOf("busy.example.com")).toBeLessThan(out.indexOf("idle-1.example.com"));
  });

  // Percentiles can't be pooled without the samples, so the summary reports the
  // worst of the hidden hosts rather than an average that would bury it.
  it("sums the rate and takes the worst of everything else", () => {
    // a and b outrank the rest, so c and d are the pair being summarised.
    const out = render([
      stat("a.example.com", { errorRate: 0.5 }),
      stat("b.example.com", { errorRate: 0.3 }),
      stat("c.example.com", { rps: 1.5, errorRate: 0.04, p99: 900 }),
      stat("d.example.com", { rps: 0.25, errorRate: 0.01, p99: 52338 }),
    ]);
    expect(out).toContain("1.75");
    expect(out).toContain("4.0% err");
    expect(out).toContain("p99 52338ms");
  });

  it("renders nothing without hosts", () => {
    expect(render([])).toBe("");
  });
});
