import { Compare } from "./compare";
import { Faq } from "./faq";
import { Footer, GetStarted } from "./get-started";
import { Hero } from "./hero";
import { More } from "./more";
import { Platform } from "./platform";
import { Showcase } from "./showcase";
import { TopBar } from "./top-bar";

/**
 * The landing page.
 *
 * Hero → five showcase panels → the rest as chips → comparison → FAQ → close:
 * promise, proof, context, objections, then the ask. Each showcase panel is
 * one claim with the interface that backs it up; the reference material lives
 * in /docs, which is why nothing here enumerates an API.
 *
 * Tone alternates canvas / ink down the showcase so the page has a spine you
 * can feel while scrolling, and the close lands on ink.
 *
 * `.od-landing` scopes an AA-compliant muted-text pair; see styles/app.css.
 */
export function Landing() {
  return (
    <div className="od-landing bg-background text-foreground">
      <a
        href="#deploy"
        className="sr-only rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50"
      >
        Skip to content
      </a>

      <TopBar />
      <main>
        <Hero />
        <Platform />
        <Showcase />
        <More />
        <Compare />
        <Faq />
        <GetStarted />
      </main>
      <Footer />
    </div>
  );
}
