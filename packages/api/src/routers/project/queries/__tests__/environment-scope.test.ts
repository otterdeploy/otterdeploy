import { idSchema } from "@otterdeploy/shared/id";
import { describe, expect, it } from "vite-plus/test";

import { resolveEnvironmentScope } from "../resource";

const MAIN = idSchema.environment.parse("env_main");
const STAGING = idSchema.environment.parse("env_staging");

describe("resolveEnvironmentScope", () => {
  it("defaults to the project's main environment when none is requested", () => {
    expect(resolveEnvironmentScope({ environmentId: MAIN })).toEqual({
      environmentId: MAIN,
      isMain: true,
    });
  });

  it("marks the requested environment as main when it IS the pointer", () => {
    expect(resolveEnvironmentScope({ environmentId: MAIN }, MAIN)).toEqual({
      environmentId: MAIN,
      isMain: true,
    });
  });

  // The distinction that matters: only main inherits the unstamped (NULL) rows.
  // Getting isMain wrong for staging would show it production's resources.
  // The exact bug this scoping exists to prevent.
  it("marks a non-main environment as not-main", () => {
    expect(resolveEnvironmentScope({ environmentId: MAIN }, STAGING)).toEqual({
      environmentId: STAGING,
      isMain: false,
    });
  });

  it("treats an explicit null request as 'no preference', not as a scope", () => {
    expect(resolveEnvironmentScope({ environmentId: MAIN }, null)).toEqual({
      environmentId: MAIN,
      isMain: true,
    });
  });

  // A project with no pointer cannot be scoped. Callers turn this into an empty
  // list rather than silently falling back to every row in the project.
  it("returns null for a project with no environment pointer", () => {
    expect(resolveEnvironmentScope({ environmentId: null })).toBeNull();
    expect(resolveEnvironmentScope({ environmentId: null }, STAGING)).toBeNull();
  });
});
