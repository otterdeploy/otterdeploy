import { describe, expect, it } from "vite-plus/test";

import { actionTone } from "./audit-helpers";

describe("actionTone", () => {
  it("classifies creation verbs as create", () => {
    expect(actionTone("projects.create")).toBe("create");
    expect(actionTone("servers.add")).toBe("create");
    expect(actionTone("git.connectPublicRepo")).toBe("create");
    expect(actionTone("sshKeys.generate")).toBe("create");
    expect(actionTone("team.invite")).toBe("create");
  });

  it("classifies destructive verbs as destroy", () => {
    expect(actionTone("projects.delete")).toBe("destroy");
    expect(actionTone("servers.remove")).toBe("destroy");
    expect(actionTone("apiKeys.revoke")).toBe("destroy");
    expect(actionTone("previews.teardown")).toBe("destroy");
    expect(actionTone("firewall.blockIp")).toBe("destroy");
  });

  it("classifies plain edits as update", () => {
    expect(actionTone("variables.update")).toBe("update");
    expect(actionTone("servers.setAvailability")).toBe("update");
    expect(actionTone("projects.rename")).toBe("update");
    expect(actionTone("domains.transfer")).toBe("update");
  });

  it("classifies state-rewinding verbs as caution", () => {
    expect(actionTone("deployments.rollback")).toBe("caution");
    expect(actionTone("backups.restore")).toBe("caution");
    expect(actionTone("previews.pause")).toBe("caution");
    expect(actionTone("builds.cancel")).toBe("caution");
  });

  it("classifies rotate as create (mints a new credential)", () => {
    expect(actionTone("sshKeys.rotate")).toBe("create");
  });

  it("classifies auth-plane actions as auth", () => {
    expect(actionTone("auth.signIn")).toBe("auth");
    expect(actionTone("session.revoke")).toBe("auth");
    expect(actionTone("mfa.challenge")).toBe("auth");
    expect(actionTone("login")).toBe("auth");
    expect(actionTone("account.logout")).toBe("auth");
  });

  it("uses only the verb segment of dotted RPC paths", () => {
    // Resource segment says "delete-ish" things, verb is a read-ish noop.
    expect(actionTone("deleteRequests.list")).toBe("neutral");
  });

  it("falls back to neutral for unknown verbs", () => {
    expect(actionTone("webhooks.inbound.invoke")).toBe("neutral");
    expect(actionTone("platform.reclaim")).toBe("neutral");
    expect(actionTone("")).toBe("neutral");
  });
});
