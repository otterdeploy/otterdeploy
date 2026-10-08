/**
 * The card lists a host the moment it is submitted, rather than
 * after the proxy reload the add waits on.
 */
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@/shared/server/orpc", () => ({ orpc: {}, queryClient: {} }));
vi.mock("@/features/projects/data/proxy-routes", () => ({ proxyRoutesCollection: {} }));

const { PendingDomainRow } = await import("./networking-card");

describe("PendingDomainRow", () => {
  it("shows the host being added, marked busy", () => {
    const html = renderToStaticMarkup(<PendingDomainRow domain="app.example.com" />);
    expect(html).toContain("app.example.com");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Adding");
  });
});
