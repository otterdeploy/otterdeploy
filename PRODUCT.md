# Product

## Register

product

## Users

Two audiences, served by one interface — neither treated as second-class:

- **Indie developers and small teams** self-hosting to own their infrastructure and escape PaaS pricing. They want Vercel-grade ease (push to git, get a deploy, see logs) running on their own servers. Their context: solo, often at night, low patience for ceremony.
- **DevOps / platform engineers** running infra for a team or org. They care about org RBAC, networking and domains, backups, observability (logs/metrics), notifications, deployment protection/firewall, and multi-service topologies. Their context: in flow, dense work, returning many times a day.

The job to be done: deploy and operate git-sourced services, databases, and networking on your own infra — and trust what you see — without the cognitive overhead of an enterprise cloud console.

## Product Purpose

otterdeploy is a self-hostable deployment platform (PaaS) — the open, own-your-infra answer to Vercel/Railway, in the lineage of Coolify and Dokploy. It builds git-sourced services (BullMQ build worker + Railpack), runs them behind a Caddy edge with multi-domain routing and Vercel-style deployment protection, and gives operators a live project graph, edge/build logs, metrics, backups, notification channels, API keys, and org-scoped access control.

Success looks like: a developer connects a repo and ships in minutes; an operator manages a multi-service org without dropping into a terminal; and at every step the dashboard is calm, fast, and honest about system state. The product wins on **trustworthy clarity** where competitors win on feature-count-at-the-cost-of-polish.

## Brand Personality

**Calm, confident infrastructure.** Quiet, trustworthy, and out of the way. Three words: *composed, precise, dependable.* The tool should disappear into the task — restraint over flash, earned familiarity over novelty. Emotional goal: the user feels *in control* and *unhurried*, even while operating real production infra. Voice in copy is plain, direct, and technically literate — never cute, never alarmist, never marketing-bright.

North stars for UI craft: **Vercel** (deploy/log/empty-state UX, restrained mono-leaning palette), **Linear** (speed, keyboard-first density, quiet confident surfaces), **Railway** (the project-as-canvas service graph), **Stripe Dashboard** (data-dense tables and semantic state color that stay legible at scale).

## Anti-references

- **Cluttered self-host UIs** — the busy, utilitarian, density-without-polish feel of Portainer and the rougher edges of Coolify/Dokploy. We match their power but not their visual noise.
- **Enterprise / cloud consoles** — AWS/GCP-style intimidation: gray walls of nested config, endless tabs, no sense of hierarchy or state.
- **Generic AI-SaaS templates** — cream/sand backgrounds, gradient text, hero-metric blocks, identical icon-card grids, eyebrow kickers on every section. None of it.
- Also not: consumer-playful, gamified, or marketing-bright. This is a serious tool for builders.

## Design Principles

1. **The tool disappears into the task.** Earned familiarity over invention. Standard affordances done impeccably beat clever ones. If a power user from Linear/Vercel sits down, nothing should feel subtly off.
2. **Honest about system state.** This is infra — builds fail, deploys pend, certs propagate, services drift. Every state (loading, pending, error, degraded, success) is designed, named, and truthful. Never fake data, never hide a failure behind a spinner. (See the project's fake-data purge: unbuilt features show "Coming soon," never seeded data.)
3. **Calm density.** Serve both the solo dev and the platform engineer by making dense information legible, not by hiding it. Hierarchy and semantic color do the work; the surface stays quiet.
4. **Fast is a feature.** Keyboard-first where it counts, 150–250ms transitions, skeletons over spinners, no page-load choreography. Users are in flow many times a day.
5. **One coherent vocabulary.** Same button, same form control, same state color, same icon style across every screen. Consistency screen-to-screen is the virtue; delight is reserved for moments, not pages.

## Accessibility & Inclusion

- **WCAG 2.2 AA** as the floor: body text ≥4.5:1, large/UI text ≥3:1, in **both light and dark themes** (devs live in dark mode — held to the same bar).
- Full keyboard navigation and visible focus on every interactive element.
- Honor `prefers-reduced-motion` — every animation needs a crossfade/instant fallback.
- Don't encode state in color alone (icon + label alongside semantic color) — matters for the build/deploy state vocabulary and color-blind operators.
