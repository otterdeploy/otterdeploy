import { describe, expect, test } from "bun:test";

import {
  getDatabaseProvisioner,
  type DatabaseProvisioner,
} from "../index";

describe("getDatabaseProvisioner", () => {
  test("returns the postgres provisioner for engine=postgres", () => {
    const provisioner = getDatabaseProvisioner("postgres");
    expect(provisioner.engine).toBe("postgres");
    expect(typeof provisioner.destroy).toBe("function");
    expect(typeof provisioner.inspectRuntime).toBe("function");
  });

  test("registered provisioners all implement the interface", () => {
    const provisioner: DatabaseProvisioner = getDatabaseProvisioner("postgres");
    expect(provisioner).toHaveProperty("provision");
    expect(provisioner).toHaveProperty("destroy");
    expect(provisioner).toHaveProperty("inspectRuntime");
  });
});
