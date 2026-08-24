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

import { describe, expect, it } from "vitest";

import { interpolate } from "../env";

/** The mapping `materializeInlineTree` (../deploy.ts) applies before writing
 *  the tree. Kept here as the unit under test so the rule is pinned even
 *  though the caller needs a database and a resource on disk. */
function renderFiles(files: ComposeFile[], vars: Record<string, string>): ComposeFile[] {
  return files.map((f) => (f.interpolate ? { ...f, content: interpolate(f.content, vars) } : f));
}

const VARS = {
  NETBIRD_DOMAIN: "https://vpn.example.com",
  NETBIRD_STORE_ENCRYPTION_KEY: "kZ9/secret+key==",
  HOME: "/should-never-be-used",
};

describe("ComposeFile.interpolate", () => {
  it("resolves refs in a flagged file", () => {
    const [rendered] = renderFiles(
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
    const [rendered] = renderFiles([{ path: "scripts/init.sh", content: script }], VARS);
    expect(rendered?.content).toBe(script);
  });

  it("treats a missing ref as empty rather than leaving the literal text", () => {
    // Empty is what compose itself does. It matters here because it is the
    // failure mode the catalog's requiredEnv check exists to prevent: an
    // unprompted key renders as "" and the install comes up insecure rather
    // than refusing to start, which is why that check is exact-equality.
    const [rendered] = renderFiles(
      [{ path: "config.yaml", interpolate: true, content: 'key: "${NOT_PROMPTED}"' }],
      VARS,
    );
    expect(rendered?.content).toBe('key: ""');
  });

  it("honours the compose `$${VAR}` escape inside a flagged file", () => {
    const [rendered] = renderFiles(
      [{ path: "config.yaml", interpolate: true, content: "literal: $${NETBIRD_DOMAIN}" }],
      VARS,
    );
    expect(rendered?.content).toBe("literal: ${NETBIRD_DOMAIN}");
  });
});
