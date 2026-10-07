/**
 * Adding a passkey never fails silently.
 */
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@/lib/auth-client", () => ({ authClient: {} }));
vi.mock("./data/use-account", () => ({ authKeys: {}, usePasskeys: vi.fn() }));

const { passkeyAddFailure } = await import("./passkeys-card");

describe("passkeyAddFailure", () => {
  it("stays quiet when the operator closed the prompt on purpose", () => {
    expect(passkeyAddFailure({ code: "ERROR_CEREMONY_ABORTED" }, "localhost")).toBeNull();
  });

  it("names the host the browser refused, and where passkeys do work", () => {
    const said = passkeyAddFailure({ code: "ERROR_INVALID_RP_ID" }, "localhost");
    expect(said).toContain("localhost");
    expect(said).toContain("HTTPS");
  });

  it("says something for every other refusal", () => {
    expect(passkeyAddFailure({ code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY" }, "h")).toMatch(
      /closed or timed out/,
    );
    expect(passkeyAddFailure({ message: "boom" }, "h")).toBe("Couldn't add a passkey: boom");
    expect(passkeyAddFailure(undefined, "h")).toBe("Couldn't add a passkey.");
  });
});
