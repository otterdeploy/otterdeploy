import { BUILT_ON, DEPLOY_LINES } from "./content";
import { BrandPanel } from "./readme-landing-brand-panel";
import { SectionHeading, Wordmark } from "./readme-landing-primitives";
import { CodeCard, FeatureGrid, InstallCommand } from "./readme-landing-sections";
import { TabBar } from "./readme-landing-tab-bar";

// ───────────────────────────────────────────────────────────────────────────
// Better-Auth-style "README" landing: a fixed left brand panel and a right
// column that scrolls and reads like a project README. All colour comes from
// the shared design tokens (styles/app.css) — light by default, with the
// Fumadocs/next-themes `dark` toggle re-scoping them. The Signal Blue accent is
// kept for the primary CTA, links, and small marks (≤10% of any screen).
//
// The page is composed from sibling modules: readme-landing-primitives (cx,
// buttons, wordmark, heading), readme-landing-brand-panel (left panel + graph),
// readme-landing-tab-bar (scroll-spy nav + theme toggle), and
// readme-landing-sections (install command, code card, feature grid).
// ───────────────────────────────────────────────────────────────────────────

export function ReadmeLanding() {
  return (
    <main className="relative min-h-screen bg-background text-foreground">
      <BrandPanel />

      <div className="lg:ml-[40%] xl:ml-[38%]">
        <TabBar />

        <div className="mx-auto px-10 py-12">
          {/* README intro */}
          <section id="readme" className="scroll-mt-16">
            <SectionHeading>Readme</SectionHeading>
            <p className="mt-4 text-[1.05rem] leading-relaxed text-foreground/90">
              Otterdeploy is a deployment platform that{" "}
              <span className="font-medium text-foreground">runs on your own servers</span>.
              Composable, typed end to end, and built to scale — from a single VPS to a multi-node
              swarm, without the usage-based bills or vendor lock-in.
            </p>
            <div className="mt-6">
              <InstallCommand />
            </div>

            {/* Built on */}
            <div className="mt-10">
              <div className="font-mono text-[11px] tracking-[0.12em] text-muted-foreground/70 uppercase">
                Built on
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
                {BUILT_ON.map((name) => (
                  <span
                    key={name}
                    className="font-mono text-[13px] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {name}
                  </span>
                ))}
              </div>
            </div>
          </section>

          {/* Features */}
          <section id="features" className="mt-16 scroll-mt-16">
            <SectionHeading>Features</SectionHeading>
            <p className="mt-3 mb-6 max-w-xl text-sm leading-relaxed text-muted-foreground">
              A complete self-hosted platform — git builds, a Caddy edge, managed data, live
              observability, and access control — driven from one CLI.
            </p>
            <FeatureGrid />
          </section>

          {/* Walkthrough code */}
          <section id="deploy" className="mt-16 scroll-mt-16">
            <SectionHeading>One command, clone to production</SectionHeading>
            <p className="mt-3 mb-6 max-w-xl text-sm leading-relaxed text-muted-foreground">
              Push your repo. Railpack detects the framework, builds it, and the Caddy edge serves
              it over HTTPS — zero-downtime, automatic TLS.
            </p>
            <CodeCard title="otterdeploy deploy" lines={DEPLOY_LINES} />
          </section>
        </div>

        {/* Footer */}
        <footer className="border-t border-border px-6 py-8 lg:px-10">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
            <Wordmark />
            <span className="font-mono text-[11px] text-muted-foreground">
              © {new Date().getFullYear()} otterdeploy · built for people who run their own infra
            </span>
          </div>
        </footer>
      </div>
    </main>
  );
}
