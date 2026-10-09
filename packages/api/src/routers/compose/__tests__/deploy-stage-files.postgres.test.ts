import { db } from "@otterdeploy/db";
import { deployment } from "@otterdeploy/db/schema";
/**
 * What a stack reads from disk is checked before anything rolls out, against
 * a migrated Postgres.
 *
 * A required env_file that is not there used to be skipped without a word, so
 * the service started missing whatever the file held. deployCompose now
 * refuses, naming the service and the path, before it opens a deployment.
 */
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

import { seedOrganization, seedProject, uniq } from "../../../__tests__/postgres-seed";
import { deployCompose } from "../deploy";
import { createComposeRecord } from "../queries";

async function seedInlineStack(input: {
  composeContent: string;
  files?: Array<{ path: string; content: string; interpolate?: boolean }>;
}) {
  const organizationId = await seedOrganization("stage");
  const { projectId, mainEnvironmentId } = await seedProject(organizationId);
  const stack = await createComposeRecord({
    projectId,
    environmentId: mainEnvironmentId,
    name: `stage-${uniq()}`,
    source: "inline",
    composeContent: input.composeContent,
    files: input.files,
    stackName: `stage-${uniq()}`,
    services: [],
  });
  return { projectId, resourceId: stack.resource.id };
}

async function deploymentCount(resourceId: Parameters<typeof deployCompose>[0]["resourceId"]) {
  const rows = await db.select().from(deployment).where(eq(deployment.resourceId, resourceId));
  return rows.length;
}

describe("deployCompose: stack files", () => {
  it("refuses a required env_file that is not in the stack, naming it", async () => {
    const stack = await seedInlineStack({
      composeContent: "services:\n  app:\n    image: nginx:alpine\n    env_file: app.env\n",
    });
    const deployed = await deployCompose(stack, "create");
    expect(deployed.isErr() && deployed.error.message).toBe(
      "These env_file targets are not in the stack files: app → app.env. " +
        "Compose refuses a missing env_file too. Add the file, or mark the entry `required: false`.",
    );
    expect(await deploymentCount(stack.resourceId)).toBe(0);
  });

  it("refuses a config file whose ${VAR} has no value, naming the variable", async () => {
    const compose = "services:\n  app:\n    image: nginx:alpine\n";
    const stack = await seedInlineStack({
      composeContent: compose,
      files: [
        { path: "compose.yml", content: compose },
        { path: "config.yml", content: `secret: \${MISSING_${uniq()}}\n`, interpolate: true },
      ],
    });
    const deployed = await deployCompose(stack, "create");
    expect(deployed.isErr() && deployed.error.message).toMatch(
      /^These stack variables have no value, and this stack's config files need them: MISSING_/,
    );
    expect(await deploymentCount(stack.resourceId)).toBe(0);
  });
});
