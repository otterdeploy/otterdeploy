/**
 * The organization plugin's team write endpoints are closed over HTTP.
 *
 * Teams are modelled on the `project` table, so those endpoints would write
 * project rows directly, past `project.create` / `project.delete` and
 * everything they do. Nothing in the product calls them. Driven through the
 * real better-auth handler with a signed-in owner's cookies, against Postgres:
 * each answers 404 and the project row is unchanged; team reads stay open.
 */
import type { OrganizationId } from "@otterdeploy/shared/id";

import { auth } from "@otterdeploy/auth";
import { db } from "@otterdeploy/db";
import { project } from "@otterdeploy/db/schema/project";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { ORIGIN, openRegistration, signIn, signUp } from "../postgres-actors";
import { seedOrganization, seedProject, uniq, type SeededProject } from "../postgres-seed";

let organizationId: OrganizationId;
let headers: Headers;
let seeded: SeededProject;
let restoreRegistration: () => Promise<void>;

beforeAll(async () => {
  restoreRegistration = await openRegistration();
  organizationId = await seedOrganization("teams");
  const owner = await signUp("team-owner");
  await auth.api.addMember({ body: { organizationId, userId: owner.id, role: "owner" } });
  headers = await signIn(owner.email);
  seeded = await seedProject(organizationId);
});

afterAll(async () => {
  await restoreRegistration?.();
});

function authRequest(path: string, init: { method: "GET" | "POST"; body?: unknown }) {
  const requestHeaders = new Headers(headers);
  requestHeaders.set("content-type", "application/json");
  return auth.handler(
    new Request(`${ORIGIN}/api/auth${path}`, {
      method: init.method,
      headers: requestHeaders,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );
}

async function projectName(): Promise<string | undefined> {
  const [row] = await db
    .select({ name: project.name })
    .from(project)
    .where(eq(project.id, seeded.projectId));
  return row?.name;
}

describe("team write endpoints", () => {
  it.each([
    "/organization/create-team",
    "/organization/update-team",
    "/organization/remove-team",
    "/organization/add-team-member",
    "/organization/remove-team-member",
    "/organization/set-active-team",
  ])("%s answers 404 and leaves the project row alone", async (path) => {
    const before = await projectName();
    const response = await authRequest(path, {
      method: "POST",
      body: {
        teamId: seeded.projectId,
        organizationId,
        name: `via-team-${uniq()}`,
        data: { name: "renamed-via-team" },
      },
    });
    expect(response.status).toBe(404);
    expect(await projectName()).toBe(before);
  });

  it("team reads stay open", async () => {
    const response = await authRequest(
      `/organization/list-teams?organizationId=${organizationId}`,
      {
        method: "GET",
      },
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(seeded.projectId);
  });
});
