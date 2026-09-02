import { Faq } from "../landing/faq";
import { Close } from "./close";
import { NextFooter } from "./footer";
import { NextHero, Stats } from "./hero";
import { Integrations } from "./integrations";
import { NextNav } from "./nav";
import { DeployPipeline } from "./pipeline";
import { PrPreview } from "./pr-preview";
import { StacksUp } from "./stacks";
import { TerminalDeploy } from "./terminal";
import { Tour } from "./tour";

/**
 * The /next landing page, v6: a product-led, genuinely animated page for the
 * self-hosted control plane.
 *
 * Real screenshots of the actual app (hero window + tour) carry the "what it
 * looks like"; two live pieces carry the "how it works" — an animated deploy
 * pipeline that runs the phases, and a terminal that types a real deploy;
 * and an integrations wall answers "does it talk to what I run." Linear's
 * composition, the `od-lin` palette. Compare/FAQ/footer are shared.
 */
export function LandingNext() {
  return (
    <div className="dark od-lin od-landing relative bg-background text-foreground">
      <a
        href="#graph"
        className="sr-only rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50"
      >
        Skip to content
      </a>

      {/* Page-top atmosphere: one continuous field behind the transparent nav
          AND the hero, so there is no black-band seam where the nav ends. A soft
          blue aurora over a masked dot-grid, dissolving into the page. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[46rem]">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(130% 92% at 50% -22%, rgba(61,123,251,0.20), rgba(61,123,251,0.06) 36%, transparent 66%), radial-gradient(70% 60% at 15% -12%, rgba(122,181,255,0.09), transparent 60%), radial-gradient(70% 60% at 85% -8%, rgba(96,165,250,0.09), transparent 60%)",
            maskImage: "linear-gradient(to bottom, #000 0%, #000 52%, transparent 98%)",
            WebkitMaskImage: "linear-gradient(to bottom, #000 0%, #000 52%, transparent 98%)",
          }}
        />
        <div
          className="absolute inset-0 opacity-[0.5]"
          style={{
            backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px)",
            backgroundSize: "26px 26px",
            maskImage: "radial-gradient(ellipse 60% 46% at 50% 0%, #000, transparent 74%)",
            WebkitMaskImage: "radial-gradient(ellipse 60% 46% at 50% 0%, #000, transparent 74%)",
          }}
        />
      </div>

      <NextNav />
      <main className="relative z-0">
        <NextHero />
        <Stats />
        <DeployPipeline />
        <Tour />
        <TerminalDeploy />
        <PrPreview />
        <Integrations />
        <StacksUp />
        <Faq />
        <Close />
      </main>
      <NextFooter />
    </div>
  );
}
