import { parseCompose } from "@otterdeploy/api/stack/compose/parse";
/**
 * Validate ONE template's `.env.schema` in isolation — the same checks as
 * `env-schema.test.ts`, without registering the schema in `ENV_SCHEMAS`.
 *
 * Exists so a schema can be authored and verified without touching the shared
 * registry: several authors (or agents) can work on different templates in
 * the same tree with no shared-file edits. Registration happens once per
 * batch, after which the vitest gate takes over.
 *
 *   bun scripts/check-env-schema.ts <templateId> --images <repo>[,<repo>] [--links]
 *
 * `--links` also confirms every `@docs` URL answers 2xx/3xx; a schema must
 * not ship a dead link, and an author cannot tell a plausible URL from a real
 * one without asking.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  rawValues,
  suggestionsFromEnvSpec,
} from "../src/features/resources/env-catalog/from-env-spec";
import { normalizeImageRepo } from "../src/features/resources/env-catalog/image-repo";
import { TEMPLATES } from "../src/features/templates/catalog/index";

const OTTERDEPLOY_REF = /\$\{\{[^}]+\}\}/;

const [templateId, ...rest] = process.argv.slice(2);
const imagesArg = rest[rest.indexOf("--images") + 1];
const checkLinks = rest.includes("--links");
if (!templateId || rest.indexOf("--images") === -1 || !imagesArg) {
  console.error(
    "usage: bun scripts/check-env-schema.ts <templateId> --images <repo>[,<repo>] [--links]",
  );
  process.exit(2);
}
const images = imagesArg
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const failures: string[] = [];
const fail = (msg: string) => failures.push(msg);

const template = TEMPLATES.find((t) => t.id === templateId);
if (!template) {
  console.error(`no template with id "${templateId}"`);
  process.exit(2);
}

const schemaPath = resolve(
  import.meta.dir,
  `../src/features/templates/catalog/env-schemas/${templateId}.env.schema`,
);
let source: string;
try {
  source = readFileSync(schemaPath, "utf8");
} catch {
  console.error(`schema not found: ${schemaPath}`);
  process.exit(2);
}

let items: Array<{ key: string; value: string; docs: string[] }> = [];
const rootDocs: string[] = [];
try {
  // The SAME projection the editors use, so this script cannot drift from
  // what the product actually reads out of a schema.
  const raw = rawValues(source);
  items = suggestionsFromEnvSpec(source).map((s) => ({
    key: s.key,
    value: raw.get(s.key) ?? "",
    docs: s.docsUrl ? [s.docsUrl] : [],
  }));
} catch (e) {
  console.error(
    `schema does not parse as @env-spec:\n${e instanceof Error ? e.message : String(e)}`,
  );
  process.exit(1);
}
// Root decorators (the header block above `# ---`) carry the project's own
// configuration reference. They belong to no item, so the projection above
// never sees them and their URLs went unverified — a schema could ship a dead
// reference link and still PASS.
for (const line of source.split("\n")) {
  if (/^\s*[A-Za-z_][A-Za-z0-9_]*=/.test(line)) break;
  for (const m of line.matchAll(/https?:\/\/[^\s,)"']+/g)) if (m[0]) rootDocs.push(m[0]);
}
if (items.length === 0) fail("schema declares no items");
const byKey = new Map(items.map((i) => [i.key, i]));

const compose = parseCompose(template.compose);
if (compose.isErr()) {
  console.error(`template compose does not parse: ${compose.error.message}`);
  process.exit(1);
}

// 1. every env key the compose sets is declared
for (const svc of compose.value.services) {
  for (const key of Object.keys(svc.env)) {
    if (!byKey.has(key))
      fail(`undeclared: ${svc.name}.${key} is set by the compose but not in the schema`);
  }
}
// 2. platform-owned values match the compose exactly
for (const svc of compose.value.services) {
  for (const [key, value] of Object.entries(svc.env)) {
    const declared = byKey.get(key);
    if (!declared || !OTTERDEPLOY_REF.test(declared.value)) continue;
    if (value !== declared.value) {
      fail(`frozen: ${svc.name}.${key} — schema says "${declared.value}", compose has "${value}"`);
    }
  }
}
// 3. every prompted key is declared
for (const v of template.requiredEnv) {
  if (!byKey.has(v.key))
    fail(`undeclared: requiredEnv.${v.key} is prompted for but not in the schema`);
}
// 4. images are ones the compose runs
const running = new Set(
  compose.value.services.flatMap((s) => (s.image ? [normalizeImageRepo(s.image)] : [])),
);
for (const img of images) {
  if (!running.has(img))
    fail(`image: "${img}" is not run by this compose (runs: ${[...running].join(", ")})`);
}
// 5. docs links resolve
if (checkLinks) {
  const urls = [...new Set([...items.flatMap((i) => i.docs), ...rootDocs])];
  const results = await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetch(url, {
          method: "GET",
          redirect: "follow",
          signal: AbortSignal.timeout(15000),
        });
        return { url, ok: res.status < 400, status: res.status };
      } catch (e) {
        return { url, ok: false, status: e instanceof Error ? e.message : "error" };
      }
    }),
  );
  for (const r of results) if (!r.ok) fail(`dead link: ${r.url} (${r.status})`);
  console.log(`links: ${results.filter((r) => r.ok).length}/${results.length} ok`);
}

const declaredRefs = items.filter((i) => OTTERDEPLOY_REF.test(i.value)).length;
console.log(
  `${templateId}: ${items.length} items (${declaredRefs} platform-owned), images ${images.join(", ")}`,
);
if (failures.length > 0) {
  console.error(`\nFAIL (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("PASS");
