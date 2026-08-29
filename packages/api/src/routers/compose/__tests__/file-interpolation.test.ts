/**
 * `ComposeFile.interpolate`: which supporting files get `${VAR}` resolved when
 * the stack's tree is materialized.
 *
 * This is the rule the NetBird template rests on. NetBird's combined server
 * keeps `authSecret` and `store.encryptionKey` in config.yaml and reads
 * neither from the environment, so a template shipping that file as literal
 * text would give every install the same two keys. Flagging the file lets the
 * values live in the stack's variables and be rendered onto disk only at
 * deploy.
 *
 * The default has to stay OFF, and the second half of this file is why:
 * `docker compose` does not interpolate side files either, so a bind-mounted
 * script's `${HOME}` has to survive verbatim.
 */
import type { ComposeFile } from "@otterdeploy/shared/compose";

import { describe, expect, it } from "vite-plus/test";

import { interpolate } from "../env";

/** The mapping `materializeInlineTree` (../deploy.ts) applies before writing
 *  the tree. Kept here as the unit under test so the rule is pinned even
 *  though the caller needs a database and a resource on disk. `missing`
 *  mirrors the set the caller gates the deploy on. */
function renderFiles(
  files: ComposeFile[],
  vars: Record<string, string>,
): { files: ComposeFile[]; missing: string[] } {
  const missing = new Set<string>();
  const rendered = files.map((f) =>
    f.interpolate ? { ...f, content: interpolate(f.content, vars, missing) } : f,
  );
  return { files: rendered, missing: [...missing].sort() };
}

const VARS = {
  NETBIRD_DOMAIN: "https://vpn.example.com",
  NETBIRD_STORE_ENCRYPTION_KEY: "kZ9/secret+key==",
  HOME: "/should-never-be-used",
};

describe("ComposeFile.interpolate", () => {
  it("resolves refs in a flagged file", () => {
    const {
      files: [rendered],
    } = renderFiles(
      [
        {
          path: "config.yaml",
          interpolate: true,
          content:
            'exposedAddress: "${NETBIRD_DOMAIN}"\nencryptionKey: "${NETBIRD_STORE_ENCRYPTION_KEY}"\n',
        },
      ],
      VARS,
    );
    expect(rendered?.content).toBe(
      'exposedAddress: "https://vpn.example.com"\nencryptionKey: "kZ9/secret+key=="\n',
    );
  });

  it("leaves an unflagged file completely alone", () => {
    // The regression this guards: a user's bind-mounted script is not a
    // template, and emptying its `${HOME}` would break it silently at deploy.
    const script = '#!/bin/sh\ncd "${HOME}" || exit 1\necho "${NETBIRD_DOMAIN}"\n';
    const {
      files: [rendered],
    } = renderFiles([{ path: "scripts/init.sh", content: script }], VARS);
    expect(rendered?.content).toBe(script);
  });

  it("reports an unset ref instead of quietly rendering it empty", () => {
    // `interpolate` still substitutes empty, the way compose does. What
    // changed is that the caller now REFUSES the deploy when this set is
    // non-empty, because a config file is not env: NetBird read
    // `authSecret: ""` and crash-looped on a message about its own schema,
    // so the operator learned their variable was blank from a stack trace in
    // someone else's product. Keys that don't fail at all (an encryption key)
    // are worse: they come up silently insecure.
    const { files, missing } = renderFiles(
      [{ path: "config.yaml", interpolate: true, content: 'key: "${NOT_PROMPTED}"' }],
      VARS,
    );
    expect(missing).toEqual(["NOT_PROMPTED"]);
    expect(files[0]?.content).toBe('key: ""');
  });

  it("reports every unset ref at once, so one redeploy can fix them all", () => {
    const { missing } = renderFiles(
      [
        { path: "config.yaml", interpolate: true, content: "${B_SECRET}\n${A_SECRET}" },
        { path: "other.yaml", interpolate: true, content: "${A_SECRET}" },
      ],
      VARS,
    );
    expect(missing).toEqual(["A_SECRET", "B_SECRET"]);
  });

  it("does not report refs inside an unflagged file", () => {
    // That file is never interpolated, so its refs are not the operator's
    // missing variables and must not block the deploy.
    const { missing } = renderFiles(
      [{ path: "scripts/init.sh", content: 'echo "${NOT_PROMPTED}"' }],
      VARS,
    );
    expect(missing).toEqual([]);
  });

  it("honours the compose `$${VAR}` escape inside a flagged file", () => {
    const {
      files: [rendered],
    } = renderFiles(
      [{ path: "config.yaml", interpolate: true, content: "literal: $${NETBIRD_DOMAIN}" }],
      VARS,
    );
    expect(rendered?.content).toBe("literal: ${NETBIRD_DOMAIN}");
  });
});
