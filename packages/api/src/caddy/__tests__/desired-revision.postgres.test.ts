/**
 * The edge's desired revision survives a stored route that fails validation.
 *
 * Every reconcile reads the revision first, and the edge watch reads it every
 * tick. The reconcile itself skips a project whose route fails validation and
 * serves the rest, so the revision must too: if one bad row made it throw, no
 * reconcile would load anything (deleting a compose stack, adding a domain)
 * until that row was gone.
 */
import { db } from "@otterdeploy/db";
import { proxyRoute } from "@otterdeploy/db/schema/proxy-route";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { seedOrganization, seedProject, seedService, uniq } from "../../__tests__/postgres-seed";
import { desiredEdgeRevision } from "../index";

const inserted: Array<(typeof proxyRoute.$inferSelect)["id"]> = [];

afterAll(async () => {
  for (const id of inserted) await db.delete(proxyRoute).where(eq(proxyRoute.id, id));
});

describe("desiredEdgeRevision", () => {
  it("leaves a route that fails validation out instead of failing", async () => {
    const organizationId = await seedOrganization("edge-revision");
    const { projectId, mainEnvironmentId } = await seedProject(organizationId);
    const svc = await seedService({ projectId, environmentId: mainEnvironmentId, name: "web" });
    const before = await desiredEdgeRevision();

    const [row] = await db
      .insert(proxyRoute)
      .values({
        projectId,
        resourceId: svc.resourceId,
        type: "http",
        domain: `unsafe-${uniq()}.example.org`,
        // Not a managed service identity: route validation refuses it.
        upstreamHost: "localhost",
        upstreamPort: 8080,
        protocol: "http",
      })
      .returning({ id: proxyRoute.id });
    if (row) inserted.push(row.id);

    const after = await desiredEdgeRevision();
    expect(after).toMatch(/^[0-9a-f]{12}$/);
    // Left out entirely: the fingerprint is the one the database had before.
    expect(after).toBe(before);
  });
});
