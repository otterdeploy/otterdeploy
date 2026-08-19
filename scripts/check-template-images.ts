/**
 * Freshness audit for the template catalog's image pins.
 *
 * Scans apps/web/src/features/templates/catalog/templates-*.ts for `image:`
 * refs, and for every EXACT version pin (v1.2.3-style tags) asks the image's
 * registry whether a newer tag exists in the same release line. Floating tags
 * (latest, `postgres:17-alpine`-style major pins) track upstream on their own
 * and are skipped. Run before a release:
 *
 *   bun run scripts/check-template-images.ts
 *
 * Exit code 1 when any pin lags, so it can gate a launch checklist.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CATALOG_DIR = "apps/web/src/features/templates/catalog";

interface Pin {
  file: string;
  registry: string;
  repo: string;
  tag: string;
}

/** `v1.2.3` / `1.2.3` / `2026.5.4` / `sha-abc` etc. Only dotted numerics with
 *  at least two segments count as an exact pin worth comparing. */
const EXACT_TAG = /^v?\d+(\.\d+){1,3}(-[\w.]+)?$/;

function parseRef(ref: string): Omit<Pin, "file"> | null {
  const noDigest = ref.split("@")[0] ?? ref;
  const slash = noDigest.lastIndexOf("/");
  const colon = noDigest.lastIndexOf(":");
  if (colon <= slash) return null; // no tag
  const repoPart = noDigest.slice(0, colon);
  const tag = noDigest.slice(colon + 1);
  const firstSeg = repoPart.split("/")[0] ?? "";
  const hasRegistry = firstSeg.includes(".") || firstSeg.includes(":");
  const registry = hasRegistry ? firstSeg : "docker.io";
  let repo = hasRegistry ? repoPart.slice(firstSeg.length + 1) : repoPart;
  if (registry === "docker.io" && !repo.includes("/")) repo = `library/${repo}`;
  return { registry, repo, tag };
}

function collectPins(): Pin[] {
  const pins: Pin[] = [];
  for (const file of readdirSync(CATALOG_DIR)) {
    if (!file.startsWith("templates-") || !file.endsWith(".ts")) continue;
    const src = readFileSync(join(CATALOG_DIR, file), "utf8");
    // Literal refs in compose bodies plus pinned consts like AUTUMN_IMAGE.
    const refs = [...src.matchAll(/image: ([^\s`"']+)/g), ...src.matchAll(/_IMAGE = "([^"]+)"/g)]
      .map((m) => m[1] ?? "")
      .filter((r) => r !== "" && !r.startsWith("${"));
    for (const ref of refs) {
      const parsed = parseRef(ref);
      if (parsed && EXACT_TAG.test(parsed.tag)) pins.push({ file, ...parsed });
    }
  }
  return pins;
}

async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

const tagsListSchema = {
  parse(value: unknown): string[] {
    if (value && typeof value === "object" && "tags" in value && Array.isArray(value.tags)) {
      return value.tags.filter((t): t is string => typeof t === "string");
    }
    return [];
  },
};

/** Anonymous pull-token flow shared by ghcr.io and quay.io / registry v2. */
async function v2Tags(registry: string, repo: string): Promise<string[]> {
  const tokenUrl =
    registry === "ghcr.io"
      ? `https://ghcr.io/token?scope=repository:${repo}:pull`
      : `https://${registry}/v2/auth?service=${registry}&scope=repository:${repo}:pull`;
  const tokenBody = await fetchJson(tokenUrl);
  const token =
    tokenBody && typeof tokenBody === "object" && "token" in tokenBody
      ? String(tokenBody.token)
      : "";
  const body = await fetchJson(`https://${registry}/v2/${repo}/tags/list`, {
    Authorization: `Bearer ${token}`,
  });
  return tagsListSchema.parse(body);
}

async function dockerHubTags(repo: string): Promise<string[]> {
  const out: string[] = [];
  let url: string | null =
    `https://hub.docker.com/v2/repositories/${repo}/tags?page_size=100&ordering=last_updated`;
  for (let page = 0; url && page < 3; page++) {
    const body = await fetchJson(url);
    if (body && typeof body === "object" && "results" in body && Array.isArray(body.results)) {
      for (const r of body.results) {
        if (r && typeof r === "object" && "name" in r && typeof r.name === "string") {
          out.push(r.name);
        }
      }
      url = "next" in body && typeof body.next === "string" ? body.next : null;
    } else url = null;
  }
  return out;
}

function numeric(tag: string): number[] | null {
  const m = /^v?(\d+(?:\.\d+){1,3})$/.exec(tag);
  return m && m[1] ? m[1].split(".").map(Number) : null;
}

function cmp(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

async function latestComparable(pin: Pin): Promise<string | null> {
  const tags =
    pin.registry === "docker.io"
      ? await dockerHubTags(pin.repo)
      : await v2Tags(pin.registry, pin.repo);
  const pinned = numeric(pin.tag.replace(/-[\w.]+$/, ""));
  if (!pinned) return null;
  let best: { tag: string; nums: number[] } | null = null;
  for (const tag of tags) {
    const nums = numeric(tag);
    if (!nums || nums.length !== pinned.length) continue; // compare like with like
    if (best === null || cmp(nums, best.nums) > 0) best = { tag, nums };
  }
  if (!best || cmp(best.nums, pinned) <= 0) return null;
  return best.tag;
}

const pins = collectPins();
let lagging = 0;
for (const pin of pins) {
  const ref = `${pin.registry === "docker.io" ? "" : pin.registry + "/"}${pin.repo}:${pin.tag}`;
  const result = await latestComparable(pin).catch((e: unknown) => {
    console.log(`?  ${ref} — could not check (${e instanceof Error ? e.message : String(e)})`);
    return null;
  });
  if (result === null) {
    console.log(`ok ${ref}`);
  } else {
    lagging += 1;
    console.log(`!! ${ref} → ${result} available (${pin.file})`);
  }
}
console.log(`\n${pins.length} exact pins checked, ${lagging} lagging.`);
process.exit(lagging > 0 ? 1 : 0);
