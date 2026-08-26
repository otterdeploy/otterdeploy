import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vite-plus/test";

import { DatabaseStatusPill } from "./panel-parts";

type Runtime = NonNullable<Parameters<typeof DatabaseStatusPill>[0]["runtime"]>;

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

/**
 * The status bar folded into this pill (see _shared/panel-header), so its
 * behaviour moved here with it. These are the same cases the bar was pinned
 * on: the runtime-less staged create is a real crash this guards.
 */
describe("DatabaseStatusPill", () => {
  // Regression: a staged database create has no container, so the draft the
  // graph panel builds from the manifest carries no `runtime`. Computing the
  // deploy-in-flight flag above the absent-runtime branch dereferenced it and
  // took the whole graph route down to the error boundary.
  it("renders without a runtime", () => {
    const out = renderToStaticMarkup(<DatabaseStatusPill runtime={undefined} />);
    expect(out).toContain("pending");
  });

  it("shows the live status once provisioned", () => {
    const out = renderToStaticMarkup(<DatabaseStatusPill runtime={runtimeFixture()} />);
    expect(out).toContain("running");
  });

  it("says unhealthy rather than running when the container is up but failing", () => {
    const out = renderToStaticMarkup(
      <DatabaseStatusPill runtime={runtimeFixture({ health: "unhealthy" })} />,
    );
    expect(out).toContain("unhealthy");
  });

  it("reads as deploying while a container is missing mid-deploy", () => {
    const out = renderToStaticMarkup(
      <DatabaseStatusPill
        runtime={runtimeFixture({ status: "missing", health: null })}
        latestDeploymentStatus="building"
      />,
    );
    expect(out).toContain("deploying");
    expect(out).not.toContain("missing");
  });

  it("keeps a genuinely dead container an error, not a deploy", () => {
    const out = renderToStaticMarkup(
      <DatabaseStatusPill
        runtime={runtimeFixture({ status: "error", health: null })}
        latestDeploymentStatus="running"
      />,
    );
    expect(out).toContain("error");
  });
});
