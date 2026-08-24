import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { FAQ_ITEMS } from "./content";
import { Band, Container, TwoTone } from "./primitives";

/**
 * Objection handling as a section. Native <details>, so every answer opens
 * before hydration and with JavaScript disabled — an FAQ that needs a
 * framework to answer "what does it cost" would be answering it wrong.
 */
export function Faq() {
  return (
    <Band id="faq">
      <Container className="py-16 lg:py-20">
        <div className="mx-auto max-w-[46rem] text-center">
          <TwoTone a="The awkward questions." b="Answered straight." />
        </div>

        <div className="mx-auto mt-10 max-w-[46rem] overflow-hidden rounded-xl border border-border bg-card">
          {FAQ_ITEMS.map((item) => (
            <details key={item.q} className="group border-border [&:not(:first-child)]:border-t">
              <summary className="flex cursor-pointer items-center gap-4 px-5 py-4 text-[0.9375rem] font-medium text-foreground transition-colors duration-200 select-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
                {item.q}
                <HugeiconsIcon
                  icon={ArrowDown01Icon}
                  className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
                />
              </summary>
              <p className="px-5 pt-0 pb-5 text-[0.875rem] leading-relaxed text-pretty text-muted-foreground">
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </Container>
    </Band>
  );
}
