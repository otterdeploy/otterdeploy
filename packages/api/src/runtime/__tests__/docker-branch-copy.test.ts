import { createId } from "@otterdeploy/shared/id";
import { expect, it, vi } from "vite-plus/test";

const snapshot = vi.hoisted(() =>
  vi.fn(async () => {
    throw new Error("ZFS attempted service-name dataset");
  }),
);
vi.mock("../snapshot", () => ({ resolveSnapshotDriver: snapshot }));
vi.mock("../../system-health/branch-pool", () => ({
  checkBranchHeadroom: async () => ({ ok: true }),
}));
vi.mock("../docker-driver-db", () => ({
  runDatabase: async () => ({ status: "running", serviceId: "branch" }),
}));
vi.mock("../docker-driver-helpers", () => ({
  findContainer: async (_docker: unknown, name: string) => ({ Id: name }),
}));
vi.mock("../../backups/copy", () => ({
  pgDumpToBuffer: async () => Buffer.from("archive"),
  pgRestoreFromBuffer: async () => undefined,
}));
import { branchDatabaseOnDocker } from "../docker-driver-branch";

it("a logical copy never invokes the host ZFS snapshot driver", async () => {
  const status = await branchDatabaseOnDocker({
    engine: "postgres",
    resourceId: createId("res"),
    sourceResourceId: createId("res"),
    projectSlug: "shop",
    deploymentId: "",
    serviceName: "branch",
    sourceServiceName: "source-service-not-volume",
    volumeName: "branch-volume",
    hostnameAlias: "branch.internal",
    public: false,
    databaseName: "db",
    username: "app",
    password: "secret",
    strategy: "copy",
    sourceCredentials: { databaseName: "db", username: "app", password: "secret" },
  });
  expect(status.status).toBe("running");
  expect(snapshot).not.toHaveBeenCalled();
});
