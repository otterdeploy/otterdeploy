/**
 * A protected deployment's member cookie stops working once the
 * member is removed from the owning organization.
 *
 * The __otter_auth cookie is minted after a membership check and lives an hour;
 * the forward_auth gate used to trust it for that whole hour. The token signing
 * is real; the route lookup and the member table are doubles.
 */
import { signSessionCookie } from "@otterdeploy/api/authz/tokens";
import { Hono } from "hono";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

const isOrgMember = vi.fn(async (_userId: string, _orgId: string) => true);
vi.mock("@otterdeploy/api/authz/org-member", () => ({ isOrgMember }));
vi.mock("@otterdeploy/api/authz/membership", () => ({
  resolveProtectedDomainOrg: async (domain: string) =>
    domain === "app.example.com"
      ? { orgId: "org_owner", projectId: "proj_1", accessPinHash: null }
      : null,
}));

const { deployAuthzHandler } = await import("../index");

const app = new Hono().get("/authz", deployAuthzHandler);

async function request(orgId: string) {
  const cookie = await signSessionCookie({
    userId: "user_member",
    orgId,
    email: "member@example.com",
    domain: "app.example.com",
  });
  return app.request("/authz?domain=app.example.com", {
    headers: { cookie: `__otter_auth=${cookie}` },
  });
}

beforeEach(() => {
  isOrgMember.mockReset();
});

describe("deployment protection member cookie", () => {
  test("a current member's cookie is allowed", async () => {
    isOrgMember.mockResolvedValue(true);
    const res = await request("org_owner");
    expect(res.status).toBe(200);
    expect(res.headers.get("Remote-User")).toBe("user_member");
    expect(isOrgMember).toHaveBeenCalledWith("user_member", "org_owner");
  });

  test("a removed member's still-valid cookie is walled off", async () => {
    isOrgMember.mockResolvedValue(false);
    const res = await request("org_owner");
    expect(res.status).not.toBe(200);
    expect(res.headers.get("Remote-User")).toBeNull();
  });

  test("a cookie minted for another organization is not accepted", async () => {
    isOrgMember.mockResolvedValue(true);
    const res = await request("org_other");
    expect(res.status).not.toBe(200);
  });
});
