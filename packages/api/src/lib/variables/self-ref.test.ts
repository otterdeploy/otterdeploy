import { describe, expect, it } from "vite-plus/test";

import { findSelfReferences } from "./self-ref";

/** The `postiz` child of the `postiz` stack: the shape that shipped the bug. */
const postiz = { resourceName: "postiz-service", stackName: "postiz", composeService: "postiz" };
const standalone = { resourceName: "web", stackName: null, composeService: null };

describe("findSelfReferences", () => {
  it("flags the stack-scoped self form the Variables tab accepted", () => {
    const found = findSelfReferences(
      [{ key: "YOUTUBE_CLIENT_ID", value: "${{postiz.postiz.GOOGLE_GMB_CLIENT_ID}}" }],
      postiz,
    );
    expect(found).toEqual([
      {
        key: "YOUTUBE_CLIENT_ID",
        raw: "${{postiz.postiz.GOOGLE_GMB_CLIENT_ID}}",
        var: "GOOGLE_GMB_CLIENT_ID",
      },
    ]);
  });

  it("flags the `stack.` self scope and the flat resource-name form", () => {
    expect(
      findSelfReferences([{ key: "A", value: "${{stack.postiz.JWT_SECRET}}" }], postiz),
    ).toHaveLength(1);
    expect(
      findSelfReferences([{ key: "A", value: "x-${{postiz-service.JWT_SECRET}}-y" }], postiz),
    ).toHaveLength(1);
  });

  it("allows the computed exports a service may read about itself", () => {
    // BETTER_AUTH_URL=${{stack.postiz.PUBLIC_URL}} is the documented pattern.
    const vars = ["HOST", "PORT", "URL", "DOMAIN", "PUBLIC_URL", "DOMAINS"].map((v) => ({
      key: `X_${v}`,
      value: `\${{stack.postiz.${v}}}`,
    }));
    expect(findSelfReferences(vars, postiz)).toEqual([]);
    expect(findSelfReferences([{ key: "A", value: "${{web.PUBLIC_URL}}" }], standalone)).toEqual(
      [],
    );
  });

  it("leaves references to siblings, other stacks, and namesake keys alone", () => {
    const vars = [
      { key: "DB", value: "${{stack.db.HOST}}" },
      { key: "OTHER", value: "${{autumn.postiz.JWT_SECRET}}" },
      // A STANDALONE resource that happens to be named like the compose key.
      { key: "NAMESAKE", value: "${{postiz.JWT_SECRET}}" },
      { key: "VAULT", value: "${{vault.hcv.secret/postiz:JWT_SECRET}}" },
      { key: "PLAIN", value: "no references here" },
    ];
    expect(findSelfReferences(vars, postiz)).toEqual([]);
  });

  it("never treats a standalone service as a stack member", () => {
    expect(findSelfReferences([{ key: "A", value: "${{stack.web.SECRET}}" }], standalone)).toEqual(
      [],
    );
    expect(findSelfReferences([{ key: "A", value: "${{web.SECRET}}" }], standalone)).toEqual([
      { key: "A", raw: "${{web.SECRET}}", var: "SECRET" },
    ]);
  });
});
