#!/usr/bin/env bun
// Regenerates apps/web/public/otterstack.schema.json from the zod
// manifestSchema. The file is served as a static asset so editors
// (VS Code, JetBrains, …) can resolve it via the `$schema` field
// embedded in user-authored otterdeploy.config.json files.

import { resolve } from "node:path";

import { manifestSchema } from "@otterstack/api/manifest";
import * as z from "zod";

const json = z.toJSONSchema(manifestSchema, {
  target: "draft-7",
  // manifestSchema uses z.transform() in a couple of places (e.g. trim
  // helpers); JSON Schema can't express those, so we degrade them to
  // `{}` rather than throwing.
  unrepresentable: "any",
}) as Record<string, unknown>;

// zod marks `.default({})` fields as required (they're never undefined
// at runtime — the default fills them in). JSON Schema validators in
// editors don't run zod, so users would get "missing property" warnings
// on omitted `services`/`databases`. Strip any key that has a `default`
// from its parent's `required` array so the editor experience matches
// the authoring contract: anything with a default is optional to write.
function relaxDefaultedRequired(node: unknown): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) relaxDefaultedRequired(item);
    return;
  }
  const obj = node as Record<string, unknown>;
  const props = obj.properties as Record<string, Record<string, unknown>> | undefined;
  const required = obj.required;
  if (props && Array.isArray(required)) {
    obj.required = required.filter(
      (key) => typeof key !== "string" || !(key in props) || !("default" in props[key]),
    );
    if ((obj.required as unknown[]).length === 0) delete obj.required;
  }
  for (const value of Object.values(obj)) relaxDefaultedRequired(value);
}
relaxDefaultedRequired(json);

json.$id = "https://otterstack.com/otterstack.schema.json";
json.title = "Otterdeploy Manifest";
json.description =
  "Schema for otterdeploy.config.json — the declarative manifest of services + databases for an otterdeploy project.";

const out = resolve(import.meta.dirname, "../public/otterstack.schema.json");
await Bun.write(out, `${JSON.stringify(json, null, 2)}\n`);

console.log(`Wrote ${out}`);
