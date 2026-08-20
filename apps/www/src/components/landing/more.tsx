import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { CHIP_GROUPS } from "./content";
import { Band, Container, Mono, TwoTone } from "./primitives";

/**
 * Everything the showcase didn't have room for, names only, grouped.
 *
 * The first draft of this page listed all of it with a sentence each, and it
 * ran for nine screens. A self-hoster comparing platforms wants to scan for
 * the one thing they need; the detail belongs in the docs, one click away.
 */
export function More() {
  return (
    <Band id="more">
      <Container className="py-16 lg:py-20">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between md:gap-10">
          <div className="max-w-[42ch]">
            <TwoTone a="The rest of the platform." b="All of it in the box you install." />
            <p className="mt-3 text-[0.9375rem] leading-relaxed text-pretty text-muted-foreground">
              No tiers, no seats, no usage bill. The detail on every name below is one click away in
              the docs.
            </p>
          </div>
          <a
            href="/docs"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md text-[0.875rem] font-medium text-foreground transition-colors duration-200 hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
          >
            Read the docs
            <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" />
          </a>
        </div>

        <div className="mt-12 grid gap-x-10 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
          {CHIP_GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="border-b border-border pb-2.5">
                <Mono className="text-muted-foreground">{group.title}</Mono>
              </h3>
              <ul className="mt-3.5 flex flex-wrap gap-1.5">
                {group.chips.map((chip) => (
                  <li
                    key={chip}
                    className="rounded-full border border-border px-2.5 py-1 text-[0.75rem] leading-none text-foreground"
                  >
                    {chip}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </Container>
    </Band>
  );
}
