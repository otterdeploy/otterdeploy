/**
 * The manifest is a PARSE boundary, and an undeclared key does not survive it.
 *
 * This is the gap that shipped the NetBird template broken. The template's
 * `config.yaml` carried `interpolate: true` and the deploy path honoured it,
 * but the wizard stages into the manifest on the way there — and the manifest's
 * file schema did not declare the flag, so zod dropped it silently. The file
 * materialized with its refs intact and the server crash-looped on
 * `parse "rels://${NETBIRD_DOMAIN}": invalid character "{" in host name`.
 *
 * Nothing else caught it: the catalog tests check the template's own data, and
 * the interpolation unit test checks the mapper in isolation. Neither crosses
 * this boundary, which is where the value was actually lost. These do.
 */
import { describe, expect, it } from "vite-plus/test";

import { composeSchema } from "../manifest/schema";

const inlineStack = (files: unknown) => ({
  source: "inline" as const,
  content: "name: netbird\nservices:\n  netbird:\n    image: x\n",
  composePath: "compose.yml",
  files,
  exposed: [],
});

describe("manifest compose files", () => {
  it("carries `interpolate` through the parse", () => {
    const parsed = composeSchema.parse(
      inlineStack([
        { path: "compose.yml", content: "name: netbird\n" },
        { path: "config.yaml", content: 'exposedAddress: "${D}"', interpolate: true },
      ]),
    );
    expect(parsed.source).toBe("inline");
    if (parsed.source !== "inline") return;
    expect(parsed.files?.[1]?.interpolate).toBe(true);
  });

  it("leaves the flag absent when a file did not ask for it", () => {
    // Absent must stay absent rather than becoming `false`: the deploy path
    // reads it as a plain truthiness check, and a pasted script's `${HOME}`
    // depends on this staying off.
    const parsed = composeSchema.parse(
      inlineStack([{ path: "scripts/init.sh", content: 'cd "${HOME}"' }]),
    );
    if (parsed.source !== "inline") return;
    expect(parsed.files?.[0]?.interpolate).toBeUndefined();
  });

  it("still accepts a stack with no files at all", () => {
    const parsed = composeSchema.parse({
      source: "inline" as const,
      content: "name: x\nservices:\n  a:\n    image: y\n",
      exposed: [],
    });
    if (parsed.source !== "inline") return;
    expect(parsed.files).toBeUndefined();
  });
});
