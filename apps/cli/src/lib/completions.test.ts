import { defineCommand } from "citty";
import { describe, expect, it } from "vite-plus/test";

import { buildTree, renderCompletion } from "./completions";

const root = defineCommand({
  meta: { name: "otterdeploy" },
  subCommands: {
    deploy: defineCommand({
      meta: { name: "deploy" },
      args: {
        config: { type: "string" },
        wait: { type: "boolean" },
        service: { type: "positional" },
      },
    }),
    env: defineCommand({
      meta: { name: "env" },
      subCommands: {
        list: defineCommand({ meta: { name: "list" } }),
        set: defineCommand({ meta: { name: "set" } }),
      },
    }),
  },
});

describe("completion tree", () => {
  it("walks the command tree and collects flags (dropping positionals)", async () => {
    const tree = await buildTree(root, "otterdeploy");
    const deploy = tree.children.find((c) => c.name === "deploy");
    expect(deploy?.flags).toContain("--config");
    expect(deploy?.flags).toContain("--wait");
    expect(deploy?.flags).not.toContain("--service");
  });

  it("recurses into nested subcommands", async () => {
    const tree = await buildTree(root, "otterdeploy");
    const env = tree.children.find((c) => c.name === "env");
    expect(env?.children.map((c) => c.name).sort()).toEqual(["list", "set"]);
  });

  it("renders a script mentioning every top-level command for each shell", async () => {
    for (const shell of ["bash", "zsh", "fish"] as const) {
      const script = await renderCompletion(root, shell);
      expect(script).toContain("deploy");
      expect(script).toContain("env");
      expect(script.length).toBeGreaterThan(0);
    }
  });
});
