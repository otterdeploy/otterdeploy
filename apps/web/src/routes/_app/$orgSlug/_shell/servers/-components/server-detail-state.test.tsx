import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { ServerState } from "@/features/servers/detail/server-state";

import { ServerStateBadge } from "./server-detail-state";

const state: ServerState = {
  kind: "stale",
  label: "Stale",
  detail: "last report 4 min ago",
  tone: "warn",
};

describe("ServerStateBadge", () => {
  it("carries the state as a word, tinted in its own hue", () => {
    const html = renderToStaticMarkup(<ServerStateBadge state={state} />);
    expect(html).toContain("Stale");
    expect(html).toContain("bg-warning/10");
    // The detail rides as a title, not as a second line inside the badge.
    expect(html).toContain('title="last report 4 min ago"');
  });
});
