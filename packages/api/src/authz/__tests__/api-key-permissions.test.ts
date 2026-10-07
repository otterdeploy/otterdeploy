/**
 * Only an ABSENT permission map is full access. A key whose stored map is
 * present but does not parse used to resolve to `null` (full access): a
 * corrupt grant widened into the most powerful key. It now grants nothing.
 * Only the auth instance is replaced, with the shapes `verifyApiKey` returns.
 */
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const verifyApiKey = vi.fn();

vi.mock("@otterdeploy/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => null), verifyApiKey } },
}));

const { resolveRequestActor } = await import("../actor");
const { authorizeCapability } = await import("../capability");

const ORGANIZATION_ID = "org_permissionsprobe";

function verifiedKey(permissions: unknown) {
  return {
    valid: true,
    error: null,
    key: { id: "key_probe", referenceId: ORGANIZATION_ID, permissions, metadata: null },
  };
}

async function canDeploy(permissions: unknown): Promise<boolean> {
  verifyApiKey.mockResolvedValue(verifiedKey(permissions));
  const resolved = await resolveRequestActor(new Headers({ "x-api-key": "otter_probe" }));
  if (resolved.isErr()) throw resolved.error;
  const decision = await authorizeCapability(resolved.value, {
    scope: "organization",
    mode: "write",
    organizationId: ORGANIZATION_ID,
    permission: { service: ["deploy"] },
  });
  return decision.allowed;
}

beforeEach(() => {
  verifyApiKey.mockReset();
});

describe("how a key's stored permission map is read", () => {
  it("no map (explicit full access, or a key minted before the choice existed) is full access", async () => {
    expect(await canDeploy(null)).toBe(true);
    expect(await canDeploy(undefined)).toBe(true);
  });

  it("a map that grants the action allows it, one that does not refuses it", async () => {
    expect(await canDeploy({ service: ["read", "deploy"] })).toBe(true);
    expect(await canDeploy({ service: ["read"] })).toBe(false);
  });

  it("a map that is present but malformed grants nothing, never full access", async () => {
    expect(await canDeploy("not-a-map")).toBe(false);
    expect(await canDeploy({ service: "deploy" })).toBe(false);
    expect(await canDeploy([["service", ["deploy"]]])).toBe(false);
  });
});
