/**
 * The card shows the host the server just accepted, from the same answer the
 * toast reads.
 */
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@/shared/server/orpc", () => ({ orpc: {}, queryClient: {} }));
vi.mock("@/features/projects/data/proxy-routes", () => ({ proxyRoutesCollection: {} }));

const { addedMessage, withDomain } = await import("./use-service-networking");

function host(id: string, domain: string, status: "live" | "disabled" = "live") {
  return { id, domain, status };
}

describe("withDomain", () => {
  it("adds the accepted host to an empty card", () => {
    expect(withDomain([], host("prt_1", "web.example.com")).map((d) => d.domain)).toEqual([
      "web.example.com",
    ]);
  });

  it("replaces a host it already lists rather than doubling it", () => {
    const before = [host("prt_1", "web.example.com", "disabled")];
    const after = withDomain(before, host("prt_1", "web.example.com", "live"));
    expect(after).toHaveLength(1);
    expect(after[0]?.status).toBe("live");
  });
});

describe("addedMessage", () => {
  // The add answers before the proxy reload: a host the edge
  // does not serve yet must not be announced as live.
  it("does not call a host live while the proxy reload is pending", () => {
    expect(addedMessage({ domain: "web.example.com", status: "live", edgeState: "pending" })).toBe(
      "web.example.com added. Applying it to the proxy",
    );
  });

  it("calls it live once the edge has it", () => {
    expect(addedMessage({ domain: "web.example.com", status: "live", edgeState: "synced" })).toBe(
      "web.example.com is live",
    );
  });

  it("asks for DNS when the host is not servable yet", () => {
    expect(
      addedMessage({ domain: "web.example.com", status: "disabled", edgeState: "synced" }),
    ).toBe("web.example.com added. Publish its DNS records to take it live");
  });
});
