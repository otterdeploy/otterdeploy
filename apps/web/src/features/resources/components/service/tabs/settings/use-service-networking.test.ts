/**
 * The card shows the host the server just accepted, from the same answer the
 * toast reads.
 */
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@/shared/server/orpc", () => ({ orpc: {}, queryClient: {} }));
vi.mock("@/features/projects/data/proxy-routes", () => ({ proxyRoutesCollection: {} }));

const { withDomain } = await import("./use-service-networking");

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
