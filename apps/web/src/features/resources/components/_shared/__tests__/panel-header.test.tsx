import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vite-plus/test";

import { PanelStatusPill, ResourcePanelHeader } from "../panel-header";

/**
 * The header's contract, not its styling.
 *
 * Two of these pin the bugs that motivated the shared component: a second
 * control that closed the panel (the back arrow, whose `onClick` was the same
 * `onClose` the ✕ called), and a status row that reprinted the resource's own
 * name on a second full-width row.
 */
describe("ResourcePanelHeader", () => {
  const base = {
    icon: <div data-testid="tile" />,
    name: "netbird",
    onClose: () => {},
  };

  it("renders exactly one control that closes the panel", () => {
    const out = renderToStaticMarkup(<ResourcePanelHeader {...base} />);
    expect(out.match(/aria-label="Close panel"/g)?.length ?? 0).toBe(1);
    // The arrow is gone for good: nothing in this row navigates back except
    // the breadcrumb, which is a link with its own label.
    expect(out).not.toContain("Back to graph");
  });

  it("puts status and meta on one line with the name, not a row of their own", () => {
    const out = renderToStaticMarkup(
      <ResourcePanelHeader
        {...base}
        status={<PanelStatusPill tone="running" label="2/2 running" />}
        meta={<>Stack · 2 services · inline file</>}
      />,
    );
    expect(out).toContain("2/2 running");
    expect(out).toContain("2 services");
    // One occurrence of the name: the title. The old status bar printed the
    // stack name a second time directly beneath it.
    expect(out.match(/netbird/g)?.length ?? 0).toBe(1);
  });

  it("omits the status block entirely when there is nothing to say", () => {
    const out = renderToStaticMarkup(<ResourcePanelHeader {...base} />);
    expect(out).not.toContain("font-mono");
  });

  it("keeps the meta trailing slot out of the truncating span", () => {
    // A long image ref must not be able to clip the live connection count.
    const out = renderToStaticMarkup(
      <ResourcePanelHeader
        {...base}
        meta={<>ghcr.io/acme/a-very-long-image-reference:v1.2.3</>}
        metaTrailing={<span>12 connections</span>}
      />,
    );
    const truncated = out.indexOf("truncate font-mono");
    const trailing = out.indexOf("12 connections");
    expect(truncated).toBeGreaterThan(-1);
    expect(trailing).toBeGreaterThan(truncated);
    expect(out).toContain("shrink-0");
  });

  it("renders actions before the close button", () => {
    const out = renderToStaticMarkup(
      <ResourcePanelHeader {...base} actions={<button type="button">Redeploy</button>} />,
    );
    expect(out.indexOf("Redeploy")).toBeLessThan(out.indexOf('aria-label="Close panel"'));
  });
});

describe("PanelStatusPill", () => {
  it("uses the graph's tone vocabulary so a node and its panel agree", () => {
    expect(renderToStaticMarkup(<PanelStatusPill tone="running" label="running" />)).toContain(
      "text-success",
    );
    expect(renderToStaticMarkup(<PanelStatusPill tone="error" label="failed" />)).toContain(
      "text-destructive",
    );
    // Paused is an operator's choice, not a failure: muted, never destructive.
    expect(renderToStaticMarkup(<PanelStatusPill tone="paused" label="paused" />)).toContain(
      "text-muted-foreground",
    );
  });
});
