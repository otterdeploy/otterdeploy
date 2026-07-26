import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vite-plus/test";

const repositoryRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../..");

// od-5j8.9: the /pty WebSocket upgrade no longer authorizes anything itself.
// It validates Origin and consumes a single-use ticket minted by the ordinary
// `terminal.mintTicket` oRPC procedure — which goes through the SAME
// createContext → resolveRequestActor → authorizeCapability pipeline every
// other procedure does (see packages/api/src/routers/terminal/authorize.ts).
// That's a stronger invariant than "this transport re-implements the check
// but calls the same function" — there is no longer a second transport to
// keep in parity at all.
const transportSources = {
  orpc: "packages/api/src/index.ts",
  rawUpload: "apps/server/src/handlers/upload/source.ts",
  terminalTicketAuthz: "packages/api/src/routers/terminal/authorize.ts",
} as const;

const websocketUpgrade = "apps/server/src/handlers/terminal/ws.ts";

function source(path: string): string {
  return readFileSync(resolve(repositoryRoot, path), "utf8");
}

describe("authorization transport parity", () => {
  for (const [transport, path] of Object.entries(transportSources)) {
    test(`${transport} delegates decisions to the central capability service`, () => {
      expect(source(path)).toContain("authorizeCapability(");
    });
  }

  test("the raw upload route delegates actor resolution instead of hand-verifying credentials", () => {
    const text = source(transportSources.rawUpload);
    expect(text).toContain("resolveRequestActor(");
    expect(text).not.toContain("auth.api.getSession");
    expect(text).not.toContain("auth.api.verifyApiKey");
  });

  test("the /pty WebSocket upgrade performs no authorization of its own — only Origin + ticket", () => {
    const text = source(websocketUpgrade);
    expect(text).not.toContain("authorizeCapability(");
    expect(text).not.toContain("resolveRequestActor(");
    expect(text).not.toContain("auth.api.getSession");
    expect(text).not.toContain("auth.api.verifyApiKey");
    expect(text).toContain("isTrustedOrigin(");
    expect(text).toContain("consumeTerminalTicket(");
  });
});
