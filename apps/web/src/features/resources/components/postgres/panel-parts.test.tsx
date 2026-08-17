import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vite-plus/test";

import { DatabaseStatusBar } from "./panel-parts";

type Runtime = NonNullable<Parameters<typeof DatabaseStatusBar>[0]["runtime"]>;

/** Complete runtime as `project.resource.list` returns it; override per test. */
function runtimeFixture(overrides: Partial<Runtime> = {}): Runtime {
  return {
    serviceId: "svc_1",
    serviceName: "acme-db",
    volumeName: "acme-db-data",
    networkName: "acme-net",
    status: "running",
    health: "healthy",
    ...overrides,
  };
}

describe("DatabaseStatusBar", () => {
  // Regression: a staged database create has no container, so the draft the
  // graph panel builds from the manifest carries no `runtime`. Computing the
  // deploy-in-flight flag above the pending branch dereferenced it and took
  // the whole graph route down to the error boundary.
  it("renders the staged bar without a runtime", () => {
    const out = renderToStaticMarkup(<DatabaseStatusBar pending runtime={undefined} />);
    expect(out).toContain("PENDING");
    expect(out).toContain("Staged");
  });

  it("stays pending when a runtime is absent even if pending was not set", () => {
    const out = renderToStaticMarkup(<DatabaseStatusBar pending={false} runtime={undefined} />);
    expect(out).toContain("PENDING");
  });

  it("shows the live status once provisioned", () => {
    const out = renderToStaticMarkup(
      <DatabaseStatusBar pending={false} runtime={runtimeFixture()} />,
    );
    expect(out).toContain("RUNNING");
    expect(out).toContain("healthy");
  });

  it("reads as deploying while a container is missing mid-deploy", () => {
    const out = renderToStaticMarkup(
      <DatabaseStatusBar
        pending={false}
        runtime={runtimeFixture({ status: "missing", health: null })}
        latestDeploymentStatus="building"
      />,
    );
    expect(out).toContain("DEPLOYING");
    expect(out).not.toContain("MISSING");
  });
});
