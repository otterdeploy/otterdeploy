/**
 * Adding a custom domain. The add writes the route first and
 * then waits on a proxy reload, so for many seconds the name is already in
 * the table: a re-check in that window used to read the operator's own host
 * as "Already in use", and the list did not show it until the add answered.
 */
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@/shared/server/orpc", () => ({ orpc: {}, queryClient: {} }));

const { Availability } = await import("./domain-add-form");

const taken = { available: false, reason: "taken" } as const;

describe("Availability", () => {
  it("says the add is running, not that the host is taken, while it is in flight", () => {
    const html = renderToStaticMarkup(
      <Availability adding checking={false} verdict={taken} onThisService={false} />,
    );
    expect(html).toContain("Adding");
    expect(html).not.toContain("Already in use");
  });

  it("names a host this service already answers on as its own", () => {
    const html = renderToStaticMarkup(
      <Availability adding={false} checking={false} verdict={taken} onThisService />,
    );
    expect(html).toContain("Already on this service");
    expect(html).not.toContain("Already in use");
  });

  it("still calls a host someone else holds taken", () => {
    const html = renderToStaticMarkup(
      <Availability adding={false} checking={false} verdict={taken} onThisService={false} />,
    );
    expect(html).toContain("Already in use");
  });
});
