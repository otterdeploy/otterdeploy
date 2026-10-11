# SEO decisions

A standing record of the strategic SEO findings raised against this repository
and what was decided about them.

## Why this file exists

The weekly SEO run lives in the private hub `dr34mw0rk5/seo-ops`. It crawls
production, reconciles the result against Search Console and Bing, and sorts
every finding into one of three tiers:

| Tier | Who fixes it | How |
| --- | --- | --- |
| 1 | nobody, deterministically | a codemod fixes it and `seo-check` blocks a recurrence |
| 2 | an automated fixer | opens a pull request, restricted to `fixAllowlist` in `seo.config.json` |
| 3 | a person | becomes an issue, never a pull request |

Tier 1 and tier 2 findings resolve themselves through the pipeline and leave no
trace worth keeping. Tier 3 findings do not. They are judgement calls, they
recur every week until somebody decides something, and the decision itself is
the artifact. Without a record, each week rereads the same finding from scratch
and cannot tell a deliberate policy apart from an unreviewed default. That is
the exact complaint the `llm.content-signal-restrictive` rule raises, so it is
worth answering once, here, rather than weekly in an issue thread.

Entries are newest first. Add a section per run that changes a decision; a run
that only confirms what is already written here needs no entry.

## 2026-09-15

Source: `findings/otterdeploy.json` at `dr34mw0rk5/seo-ops@02800aac`, run
`34961477413`. Six findings, all tier 3, all at occurrence 2 (first seen
2026-09-08). No tier 1 and no tier 2 findings, so nothing in this run was
mechanically fixable.

### Verification performed

Before deciding anything, the hub's rule engine was run against production with
this repository's own `seo.config.json`:

```
SEO check: 19 pages, 19 sitemap URLs
No blocking SEO defects.
```

No blocking findings and no advisory findings. The on-page surface that tier 1
and tier 2 rules police (titles, descriptions, canonicals, `h1` counts, JSON-LD,
Open Graph, sitemap parity, internal links) is clean.

### `index.not-indexed`, five URLs

`/docs/cli/commands`, `/docs/guides/templates`, `/docs/openapi`,
`/docs/start/first-deploy` and `/privacy` are reported by Search Console as
"URL is unknown to Google".

Each was checked by hand. All five answer `200`, carry a correct self-referential
canonical, a unique title, a unique meta description, exactly one `h1`, and
JSON-LD where the template provides it. All five are listed in `sitemap.xml`.
All five are reachable by internal link, several of them prominently:
`/docs/start/first-deploy` has seventeen inbound links and `/docs/openapi`
sixteen, which is as many as pages Google has indexed without trouble. Googlebot
receives a full response in under 0.3 seconds.

There is therefore no defect to fix. "Unknown to Google" here describes crawl
budget on a site whose search footprint is still new, not a technical barrier.

**Decision: wait it out.** No action, no code change. The finding closes itself
once Google crawls the URLs. Revisit only if it is still open once the
surrounding pages have been indexed for several weeks, which would suggest
something other than crawl budget.

Note that identical `<lastmod>` values across every docs page are correct and
not a symptom: commit `e4c98a47` was a squash merge that genuinely touched every
file under `apps/www/content/docs`.

### `llm.content-signal-restrictive`, `/robots.txt`

Production `robots.txt` carries
`Content-Signal: search=yes,ai-train=no,use=reference`. The rule accepts this as
legitimate but asks that it be a deliberate choice rather than a default.

It is currently a default. The signal is not emitted by this repository.
`robotsTxt()` in `apps/www/src/lib/shared.ts` writes no `Content-Signal` line at
all. The directive arrives from Cloudflare, inside a block delimited by
`# BEGIN Cloudflare Managed content` and `# END Cloudflare Managed Content`, and
is configured under AI Crawl Control in the Cloudflare dashboard.

The same injected block does more than declare a signal. It also disallows nine
crawlers outright at the root:

```
Amazonbot, Applebot-Extended, Bytespider, CCBot, ClaudeBot,
CloudflareBrowserRenderingCrawler, Google-Extended, GPTBot, meta-externalagent
```

Those `Disallow: /` rules are the operative restriction. `Content-Signal` is a
declaration of intent that a crawler may honour; a `Disallow` is what actually
keeps it out. Relaxing one without the other would leave the policy saying two
different things.

**Decision: relax, to allow AI training.** The documentation is a growth channel
and being absent from model answers costs more than the reservation of rights
buys.

This decision cannot be carried out in this repository. It requires turning the
managed Content-Signal off, or setting `ai-train=yes`, under AI Crawl Control in
the Cloudflare dashboard, together with a decision about the nine `Disallow`
rules in the same block. Until that happens the finding stays open and recurs
weekly; nothing in a pull request can close it.

Deliberately not done here: adding a `Content-Signal` line to `robotsTxt()`.
While Cloudflare still injects its own block, a second line would put two
contradictory `ai-train` values in one file, and the rule matches
`ai-train\s*=\s*no` anywhere in the document, so the finding would not clear
either. Once the managed block is off, emitting the signal from `robotsTxt()` is
the better home for it, because the policy then lives in version control next to
the rest of the crawl configuration.

### A side effect worth knowing about

The injected block opens with its own `User-agent: *` group, which lands ahead of
the group this repository serves. Production `robots.txt` therefore contains two
`User-agent: *` groups, and the first one carries neither `Disallow: /api/` nor
`Disallow: /_serverFn/` nor the `Sitemap:` line.

The specification says a crawler should merge groups that name the same agent,
and a crawler that does so sees the intended policy. A crawler that instead
takes only the first matching group sees a permissive one. This is not currently
reported as a finding, because both groups allow the root and the hub's
contradiction rule only fires on disagreement about it.

No action for now. It resolves on its own if the managed block is switched off
as part of the decision above.

## Configuration drift, hub versus repository

`seo.config.json` asks to be kept in sync with the `otterdeploy` entry in
`dr34mw0rk5/seo-ops/sites.json`. As of 2026-09-15 the two disagree, and the hub
is the side that is behind:

| Key | This repository | Hub `sites.json` |
| --- | --- | --- |
| `ignore` | also has `^/docs/openapi/` | missing it |
| `fixAllowlist` | also has `apps/www/src/components/landing-next/content.ts` | missing it |

Both extras here are correct and should be copied to the hub rather than deleted
from this file.

`^/docs/openapi/` is a guard, not dead configuration. It currently changes
nothing: running the engine against production with and without it gives the
same nineteen pages and the same zero findings, because no operation pages exist
in production while the OpenAPI spec URL is unset and the loader falls back to an
empty document. The day that URL is configured, the virtual operation pages
appear, and without the guard the crawl would pull in every one of them. Removing
the entry is a regression that would lie dormant until exactly the wrong moment.

`landing-next/content.ts` exists on `main` and holds the copy for the landing
page that was promoted to `/`. Dropping it from `fixAllowlist` would stop the
tier 2 fixer from editing the live landing copy, which is one of the few places
it is meant to work.
