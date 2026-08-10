# Template Registry, serving the catalog instead of compiling it

**Status:** Proposed. Nothing built.
**Last verified:** 2026-08-04
**Scope:** How deployable stack templates are authored, validated, delivered, and resolved. Does not change what a template *is* (a compose file + typed metadata) or how deploying one works (the compose wizard, unchanged).

We ship **18** templates. Coolify ships **335**. The gap is not authoring effort. It is that every one of our templates is a TypeScript literal compiled into the SPA, so adding one is a frontend release. This proposes moving the catalog behind an endpoint, keeping the validation gate that makes our 18 trustworthy, and keeping the app working when the network doesn't.

---

## 0. Why this is a delivery problem, not a content problem

The catalog has not grown since July. That is the honest signal: the cost per template is not "write 60 lines of YAML", it is "write 60 lines of YAML, rebuild the web bundle, cut a release, and make every user update to see it."

Coolify adds templates continuously because for them it is a data change. Their instances poll a JSON file; a new template appears without anyone updating anything. That difference (**content ships on the content's schedule, not the product's**) is the entire feature.

Writing 300 more templates into `catalog/templates-*.ts` would work exactly once and then leave us with a 1 MB bundle and the same release coupling. Architecture first.

---

## 1. Current state (verified against code)

| Area | Today | File |
| --- | --- | --- |
| Catalog | `TEMPLATES: StackTemplate[]`, six category files spread-concatenated | `apps/web/src/features/templates/catalog/index.ts:18` |
| Count | **18**: data 5, dev 4, analytics 3, ops 3, cms 2, crm 1 | `catalog/templates-*.ts` |
| Entry shape | `id, name, description, category, includes[], requiredEnv[], logoBrand, docsUrl, compose` | `catalog/types.ts:40` |
| Compose storage | Template literal inside a `.ts` file, `${VAR}` escaped as `\${VAR}` | `catalog/templates-crm.ts:30` |
| Categories | 8, hardcoded union + label array | `catalog/types.ts:11`, `:21` |
| Delivery | Compiled into the web bundle (~27 KB of source today) |: |
| Gallery | Reads `TEMPLATES` directly, synchronously | `components/templates-gallery.tsx:27` |
| Filter/sort | Pure functions over the array | `catalog/filter.ts` |
| Route | `/$orgSlug/templates`, `?project=<slug>` preselects deploy target | `routes/_app/$orgSlug/_shell/templates.tsx` |
| Deploy handoff | `router.history.push('/<org>/<proj>/graph?new=template&template=<id>')` | `components/template-detail-dialog.tsx:181` |
| Handoff resolution | **Synchronous** `getTemplateById(id)` deriving wizard `open` from the URL | `features/projects/components/new-resource/overlay-provider.tsx:45` |
| Validation | Build-time test: parses every compose with the repo's own parser | `catalog/catalog.test.ts` |
| Logos | `logoBrand` → SvglLogo search, monogram fallback | `shared/components/brand/svgl-logo.tsx:49` |
| Artifact edge | `get.otterdeploy.com`: CF Worker + R2, no origin, falls back to raw.githubusercontent.com on miss | `apps/get/README.md` |

### 1.1 The honesty gate: the thing we must not lose

`catalog.test.ts` is the best part of the current design and has no equivalent in Coolify. For **every** template it asserts:

- the compose round-trips **`parseCompose`** (the same parser the wizard preview and the deploy reconciler use) with **zero warnings**
- `includes` equals the parsed service names, exactly
- `requiredEnv` equals the `${VAR}` refs the file actually declares without defaults
- images only, no `build:` contexts, so a template deploys without a repo

This is why our 18 are trustworthy. Coolify validates by users hitting deploy failures; their 335 is partly a volume-over-verification trade.

**The gate runs at build time against a compiled-in array.** Serve the catalog as data and it protects nothing unless it moves too. That constraint drives §3.

### 1.2 The synchronous-resolution landmine

`overlay-provider.tsx:45` derives whether the wizard is open from `getTemplateById(...) != null`, **during render**:

```ts
const template = handoff.startsWith("template:") ? getTemplateById(...) : null;
const fromUrl = handoff === "service" || template != null;
const open = openedInApp || fromUrl;
```

Its comment is explicit that openness and prefill are *derived from the address bar, no effect mirrors one into state*, and that **unknown template ids read as no handoff**.

Make the lookup async naively and: first render → `undefined` → `open` false → the wizard does not open → data arrives → it pops open. A visible flash on a deep link, and an "unknown id" and "not loaded yet" become indistinguishable. §4.3 handles this.

---

## 2. How Coolify does it (verified against source, 2026-08-04)

`config/constants.php:28`:

```php
'services' => [
    'official'   => 'https://cdn.coollabs.io/coolify/service-templates-latest.json',
    'file_name'  => 'service-templates-latest.json',
    'cache_key'  => 'coolify:service-templates-bundle',
],
```

Probed live: **HTTP 200, 1,048,408 bytes, 335 templates, 35 categories.**

`get_service_templates(bool $force = false)` (`bootstrap/helpers/shared.php:1319`) is a three-tier cascade:

1. **`$force`** → `Http::retry(3, 1000, throw: false)->timeout(60)->connectTimeout(10)` GET the CDN, `store_service_templates_bundle($response->body())`, return it. `$response->failed()` → empty collection. Any throw → recurse into the non-forced path.
2. **Normal** → read the cache bundle, `Cache::remember("service-templates:shared:{$fetchedAt}", now()->addDay(), …)`.
3. **Cold cache** → read the local file shipped in the image, `Cache::remember("service-templates:{$mtime}", …)`.

Their entry:

```json
"apprise-api": {
  "documentation": "…", "slogan": "Push Notifications API",
  "compose": "<base64>", "tags": ["api","apprise"],
  "category": "automation", "logo": "svgs/apprise.png",
  "minversion": "0.0.0", "template_last_updated_at": "…", "port": "8000"
}
```

### What to take

| Their decision | Take it? | Why |
| --- | --- | --- |
| Remote JSON as source of truth | **Yes** | The whole point: content ships independently. |
| Local file fallback in the image | **Yes** | Fresh/air-gapped installs still get a catalog. Never a blank gallery. |
| Never block the UI on the network | **Yes** | Failure returns cached or empty, never an error page. |
| `minversion` per template | **Yes** | One file serves every version in the wild. A template needing a parser feature an old instance lacks stays hidden instead of failing at deploy. |
| Base64 compose | **Yes** | Sidesteps YAML-in-JSON escaping entirely. Our current `\${VAR}` escaping in `.ts` is the same class of problem. |
| Author YAML, generate JSON | **Yes** | Reviewable diffs; the generated artifact is never hand-edited. |
| Refresh only on explicit force | **No** | Theirs needs a manual trigger or a scheduled job. Prefer a TTL-based background refresh. |
| Flat `id → entry` object | **No** | An array with an explicit `id` sorts and validates more cleanly, and lets us add a top-level `schemaVersion`. |
| `slogan` + `tags` + `port` | **Partly** | Keep our richer `requiredEnv` and `includes`; those carry the gate. |

---

## 3. Proposed design

### 3.1 Shape

```
templates/                          ← authored, reviewable
  twenty.yaml                         compose + front-matter metadata
  ghost.yaml
  …
scripts/templates/build.ts          ← generator + THE GATE
  → apps/web/public/templates.json    (bundled fallback, committed)
  → R2 via publish-artifacts          (served, versioned)
```

Authoring moves from `.ts` to YAML with front-matter, so a contributor writes compose, not TypeScript:

```yaml
# id: twenty
# name: Twenty
# category: crm
# logoBrand: Twenty
# docsUrl: https://twenty.com/developers/section/self-hosting/docker-compose
# minVersion: 0.10.0
# description: >
#   Open-source CRM, a modern, keyboard-first alternative to Salesforce.
name: twenty
services:
  twenty:
    image: twentycrm/twenty:v2.20.0
    …
```

`includes` and `requiredEnv` are **derived by the generator**, not authored. Today they are hand-written and the test asserts they match. Deriving them makes a whole class of drift impossible instead of merely detected.

### 3.2 The gate moves into the generator

`catalog.test.ts`'s assertions become the generator's failure conditions, run against `parseCompose` exactly as now. A template that does not parse cleanly **is not emitted**. The published JSON is then valid by construction.

`catalog.test.ts` itself stays, re-pointed at the generated `templates.json`, so CI still fails if a bad artifact is committed. Both ends covered: the generator can't emit garbage, and CI can't accept garbage.

This is the single most important part of the proposal. Serving templates without moving the gate would trade our one real advantage over Coolify for a bigger number.

### 3.3 Delivery: `get.otterdeploy.com`, not a new service

`apps/get` already is what we need, a Worker with no origin, artifacts in R2, written only by `publish-artifacts`, falling back to `raw.githubusercontent.com` on a miss. Adding one path:

| URL | Serves |
| --- | --- |
| `/templates.json` | Newest catalog |
| `/<tag>/templates.json` | That release's catalog, immutable |

No new infrastructure, no new hostname, the same publish path and the same cold-start fallback.

### 3.4 Server-side, not browser-side

The **control plane** fetches and caches; the browser only ever talks to our own API.

- The SPA calling `get.otterdeploy.com` directly would need CORS, would leak every user's IP to the edge, and would be blocked in air-gapped installs where the control plane could still serve its bundled copy.
- One fetch per instance, not per browser tab.
- The server already holds Redis, which is where the cached bundle belongs.

```
template.registry.list()  → { templates: TemplateSummary[], fetchedAt, source }
template.registry.get(id) → { template: StackTemplate } | null
```

`list` omits `compose` (the bulk); `get` returns it. At Coolify's scale that is ~1 MB versus a few KB per card. The gallery needs name/description/category/includes/logo to render and filter; only the detail dialog and the wizard need the file.

### 3.5 The cascade

Coolify's three tiers, with a TTL instead of a manual force:

1. **Redis** `otterdeploy:templates:bundle`: if `fetchedAt` is within TTL (24h), serve it.
2. **Stale-while-revalidate**: past TTL, serve the stale bundle *immediately* and refresh in the background. The gallery is never slower than cache-read latency.
3. **Bundled fallback**: cold cache and fetch failed → `apps/web/public/templates.json`, shipped in the image. Never an empty gallery, never an error.

`source: "remote" | "cache" | "bundled"` rides on the response, and the gallery says so plainly when it is serving bundled content, the honest-about-system-state principle. A user on an air-gapped box should know why they see 18 and not 335.

Every fetch validates against the schema **before** replacing a good cached bundle. A corrupt or truncated publish must never blank a working catalog.

### 3.6 Wire schema

```ts
{
  schemaVersion: 1,
  generatedAt: "2026-08-04T…Z",
  templates: [{
    id, name, description, category,
    includes: string[],           // derived
    requiredEnv: TemplateEnvVar[],// derived
    logoBrand, docsUrl,
    compose: string,              // base64
    minVersion: string,           // semver; hidden from older instances
    updatedAt: string,
  }]
}
```

`minVersion` is filtered **server-side** against the running version, so the client never sees a template it cannot deploy.

`category` widens from the current 8-value union to an open string with a known-label map; an unknown category from a newer file must render (title-cased) rather than break the filter pills. Coolify has 35 categories; ours will grow, and a closed union means a template is invisible until the frontend ships a new enum value. Reintroducing exactly the coupling this removes.

---

## 4. Migration

### 4.1 Order

1. Generator + gate, emitting today's 18 from the existing `.ts` files. Output committed. **No behaviour change**, prove the artifact matches what ships now.
2. Convert the 18 to authored YAML. Generator output must be byte-identical to step 1; that diff is the proof the conversion was lossless.
3. `template.registry.*` endpoints, reading the bundled file only. No network yet.
4. Frontend reads the endpoints instead of the array. §4.3 first.
5. R2 publish + the remote tier + stale-while-revalidate.
6. Only then, write templates.

Each step is independently shippable and independently revertible.

### 4.2 What stays

The compose wizard, `parseCompose`, staging, the manifest flow, the graph, untouched. This changes where a template *comes from*, not what happens when you deploy one. The deploy handoff URL (`?new=template&template=<id>`) stays byte-identical so existing links keep working.

### 4.3 Fixing the synchronous handoff first

Before the frontend can read async data, `overlay-provider.tsx` must stop deriving `open` from template *resolution*. Split the two questions it currently conflates:

```ts
// Openness derives from the URL SHAPE, always synchronous, always correct.
const wantsTemplate = handoff.startsWith("template:");
const templateId = wantsTemplate ? handoff.slice("template:".length) : null;
const open = openedInApp || handoff === "service" || wantsTemplate;

// Resolution is a separate, async question the wizard body handles.
const { data: template, isLoading } = useTemplate(templateId);
```

The wizard then opens instantly on a deep link and shows a loading state in the template step; an id that resolves to nothing becomes an explicit "template not found" rather than a silently-not-opening dialog, which is better than today's behaviour, where a typo'd id just does nothing.

Do this as its own change, on the current synchronous catalog, so the refactor is verifiable in isolation.

### 4.4 Risks

| Risk | Mitigation |
| --- | --- |
| Bad publish blanks every instance's gallery | Schema-validate before replacing cache; bundled fallback; immutable `/<tag>/` URLs to roll back |
| Remote catalog becomes an unreviewed input | It is generated only by CI from the repo; the gate runs in the generator; R2 is written only by `publish-artifacts`, never by hand |
| Serving user-authored compose | Out of scope. This is a first-party curated catalog. Custom/community templates need a separate threat model and are not proposed here |
| Losing the gate under growth pressure | The generator *cannot* emit an invalid template. Not policy, mechanism |
| Bundle-size regression | `list` omits compose; the bundled fallback is a public asset, fetched not parsed at boot |
| i18n | Template copy is English-only today and stays so. Names/descriptions are content, not UI chrome, worth a decision but not a blocker |

---

## 5. Open questions

1. **TTL**: 24h matches Coolify. Shorter makes new templates appear sooner; longer is quieter. Is a manual "Check for new templates" button worth it?
2. **Ship count in the image**: bundle all templates as fallback, or a curated subset to keep the image small? At Coolify's 1 MB, all of them is fine.
3. **Per-instance opt-out**: should an operator be able to pin to bundled-only (no outbound fetch)? Air-gapped installs and some compliance postures want this. Cheap to add now (`TEMPLATE_REGISTRY=bundled|remote`), awkward later.
4. **Telemetry**: `apps/get`'s README is explicit that a stable URL doubles as the only signal of how many people run otterdeploy. A catalog poll is the same kind of signal. If we want it, say so out loud in the docs rather than acquiring it as a side effect.
5. **The deploy-time FQDN ref**: see §7. The only genuinely missing piece of the "one-click" story.

---

## 6. What this does not solve

Serving 335 templates does not make them *good*. Coolify's catalog contains templates that fail to deploy, because nothing validates them. Our gate means our count grows more slowly and every entry works.

That is the right trade, and it should stay the trade after this lands. The goal is not to match 335. It is to stop the delivery model being the reason we have 18.

---

## 7. Magic variables: we already have them

An earlier draft of this doc listed "adopt Coolify's magic variables
(`SERVICE_PASSWORD_X`, `SERVICE_FQDN_X_PORT`)" as an open question, on the
assumption that we ask the user for every `${VAR}`. **That was wrong.** Both
halves exist; they are spelled differently and live in two different layers.

| Coolify | otterdeploy | Where |
| --- | --- | --- |
| `SERVICE_PASSWORD_X` | `SECRETISH` key heuristic → `randomSecret()` | `compose-wizard-parse.ts:95`, `shared/src/crypto.ts:68` |
| `SERVICE_FQDN_X` / `_PORT` | `${{svc.PUBLIC_URL}}` / `.DOMAIN` / `.DOMAINS` / `.HOST` / `.PORT` | `lib/variables/exporters.ts:55`, `:83` |
| DB credential wiring | `${{db.DATABASE_URL}}`, `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE` | `lib/variables/exporters.ts:27` |
|: (no equivalent) | `${secret}`, `${database:<n>.<field>}`, `${service:<n>.host\|port>}` | `stack/manifest/refs.ts` |

Secret generation is real and unconditional:

```ts
const secret = SECRETISH.test(ref.name);
return { key: ref.name, value: ref.default ?? (secret ? randomSecret() : ""), secret, required };
```

`SECRETISH` matches `SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|API_?KEY|ACCESS_?KEY|CREDENTIAL|DSN|AUTH|SALT|WEBHOOK|SIGNING`; `randomSecret()` is 24 bytes of `crypto.getRandomValues`, base64url.

**Ours is arguably the better half of the trade.** Coolify's only fires when the
template author wrote the magic prefix, so a pasted third-party compose file
gets nothing. Ours is a heuristic on the key name, so it works on **any**
compose file with zero template authoring. The cost is that a heuristic can
miss (`ROOT_PW`, `PGPASS`) or over-fire on something that isn't a credential.

### 7.1 What is actually missing: a fill-time FQDN

Twenty, our one CRM template, declares three required vars:

| Var | Today |
| --- | --- |
| `APP_SECRET` | matches `SECRET` → auto-generated |
| `POSTGRES_PASSWORD` | matches `PASSWORD` → auto-generated |
| `SERVER_URL` | no match → **operator must type it** |

So it is already one field, not three. The single remaining gap is that
`SERVER_URL` needs *the domain the stack is about to be given*. We do generate
that domain (`service.domains.generate` mints the platform/sslip host, and the
compose reconcile seeds exposure: `routers/compose/reconcile.ts:128`), but
only **after** deploy. The template needs it **before**.

That is the exact chicken-and-egg `SERVICE_FQDN_X` solves by minting the FQDN at
instantiation time and injecting it. It is one ref resolvable at variable-fill
time, not a missing system.

Sketch, deliberately not designed here: the wizard can compute the sslip host
for `(project, service)` deterministically before staging, and expose it as a
fill-time ref (`${{self.PUBLIC_URL}}` or similar) that seeds the field the way
`randomSecret()` seeds a password. The operator can still overwrite it with a
custom domain. Needs its own design. The naming has to reconcile with the
existing `${{Resource.VAR}}` grammar, and a *generated* value that the user
then overrides has to not fight the reconcile rules in `architecture-decision
-2026-07-25` (service settings own exposure; reconciles must not wipe
imperative changes).

### 7.2 A bug this surfaced

`StackTemplate.requiredEnv[].generateHint` carries strings like
`openssl rand -base64 32`, and the detail dialog renders them
(`template-detail-sections.tsx:84`). So the modal instructs the operator to
generate `APP_SECRET` by hand: **a value the wizard auto-fills two clicks
later**, on a step whose own copy reads "secrets are auto-generated, defaults
pre-filled" (`compose-wizard-body.tsx:34`).

Two surfaces, contradicting each other, about the same value. The fix is
probably to drop `generateHint` for anything `SECRETISH` matches and say
"generated for you" instead, but that couples template metadata to a frontend
heuristic, which is an argument for moving the heuristic somewhere both can
read. Worth settling as part of the registry work, since `requiredEnv` becomes
generator-derived (§3.1) and the generator could mark each var
`autofilled: true|false` from the same regex.
