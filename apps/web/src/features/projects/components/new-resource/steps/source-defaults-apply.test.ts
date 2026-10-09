import { FormApi } from "@tanstack/react-form";
import { describe, expect, it } from "vite-plus/test";

import type { RepoInspection } from "./source-defaults-apply";

import { resourceDefaults, type ResourceFormState } from "../schemas";
import { createSourceDefaults } from "./source-defaults-apply";

/** The same typed form the wizard's context hands the steps, minus React. */
function makeForm(values: Partial<ResourceFormState>) {
  const form = new FormApi<
    ResourceFormState,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined
  >({ defaultValues: { ...resourceDefaults, ...values } });
  form.mount();
  return form;
}

function bind(form: ReturnType<typeof makeForm>, inspection: RepoInspection) {
  return createSourceDefaults(
    form,
    { inspect: async () => inspection, inspectEnv: async () => ({ keys: [] }) },
    { current: false },
  );
}

/** github.com/CorentinTh/it-tools: a Vite app whose Dockerfile serves nginx on 80. */
const IT_TOOLS: RepoInspection = {
  fullName: "CorentinTh/it-tools",
  framework: "vite",
  dockerfile: { path: "Dockerfile", exposedPorts: [80] },
  monorepo: null,
  monorepoPackages: [],
};

describe("createSourceDefaults: a repo with a Dockerfile", () => {
  it("builds with the Dockerfile, as a web app, on the port it EXPOSEs", async () => {
    const form = makeForm({ kindId: "app" });

    await bind(form, IT_TOOLS).onRepoBound("gitr_ittools");

    expect(form.getFieldValue("builderId")).toBe("dockerfile");
    // Static would build with railpack and throw the Dockerfile away.
    expect(form.getFieldValue("kindId")).toBe("app");
    expect(form.getFieldValue("ports")[0]?.port).toBe(80);
    expect(form.getFieldValue("name")).toBe("it-tools");
  });

  it("moves a Static preselection back to Web app when the repo has a Dockerfile", async () => {
    const form = makeForm({ kindId: "static" });

    await bind(form, IT_TOOLS).onRepoBound("gitr_ittools");

    expect(form.getFieldValue("kindId")).toBe("app");
  });

  it("switching to Railpack moves the port to the framework default, and back again", async () => {
    const form = makeForm({ kindId: "app" });
    const defaults = bind(form, {
      ...IT_TOOLS,
      framework: "next",
      dockerfile: { path: "Dockerfile", exposedPorts: [8080] },
    });
    form.setFieldValue("repo", "gitr_next");
    await defaults.onRepoBound("gitr_next");
    expect(form.getFieldValue("ports")[0]?.port).toBe(8080);

    await defaults.onBuilderPicked("railpack");
    expect(form.getFieldValue("builderId")).toBe("railpack");
    expect(form.getFieldValue("ports")[0]?.port).toBe(3000);

    await defaults.onBuilderPicked("dockerfile");
    expect(form.getFieldValue("ports")[0]?.port).toBe(8080);
  });

  it("never moves a port or builder the operator chose", async () => {
    const form = makeForm({ kindId: "app" });
    form.setFieldValue("ports", [{ port: 9999, protocol: "http", public: true, host: "" }]);
    form.setFieldValue("builderId", "railpack");

    await bind(form, IT_TOOLS).onRepoBound("gitr_ittools");

    expect(form.getFieldValue("builderId")).toBe("railpack");
    expect(form.getFieldValue("ports")[0]?.port).toBe(9999);
  });
});

describe("createSourceDefaults: a repo without a Dockerfile keeps the railpack path", () => {
  it("a Vite SPA stays a railpack static site", async () => {
    const form = makeForm({ kindId: "app" });

    await bind(form, { ...IT_TOOLS, dockerfile: null }).onRepoBound("gitr_spa");

    expect(form.getFieldValue("builderId")).toBe("railpack");
    expect(form.getFieldValue("kindId")).toBe("static");
  });

  it("a Next.js app stays a railpack web app on 3000", async () => {
    const form = makeForm({ kindId: "app" });

    await bind(form, { ...IT_TOOLS, framework: "next", dockerfile: null }).onRepoBound("gitr_n");

    expect(form.getFieldValue("builderId")).toBe("railpack");
    expect(form.getFieldValue("kindId")).toBe("app");
    expect(form.getFieldValue("ports")[0]?.port).toBe(3000);
  });

  it("re-binding a repo without a Dockerfile drops the previous repo's Dockerfile choice", async () => {
    const form = makeForm({ kindId: "app" });
    const withDocker = bind(form, IT_TOOLS);
    await withDocker.onRepoBound("gitr_ittools");
    expect(form.getFieldValue("builderId")).toBe("dockerfile");

    await bind(form, { ...IT_TOOLS, framework: "go", dockerfile: null }).onRepoBound("gitr_go");

    expect(form.getFieldValue("builderId")).toBe("railpack");
    expect(form.getFieldValue("ports")[0]?.port).toBe(8080);
  });
});
