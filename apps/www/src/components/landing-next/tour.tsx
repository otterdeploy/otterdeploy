import { Band, Container, Mono } from "../landing/primitives";
import { TOUR, type TourStop } from "./content";
import { Reveal } from "./reveal";

/**
 * The product tour: each real control-plane surface paired with what it does,
 * image and copy alternating sides — Linear's feature-fold rhythm. Every
 * image is a real 2x screenshot of the app in a browser frame.
 */

function Frame({ img, alt }: { img: string; alt: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.1] bg-[#0c0d0e] shadow-[0_24px_80px_-32px_rgba(0,0,0,0.9)]">
      <img
        src={img}
        alt={alt}
        width={3200}
        height={1770}
        loading="lazy"
        decoding="async"
        className="block w-full"
      />
    </div>
  );
}

function Stop({ stop }: { stop: TourStop }) {
  return (
    <article id={stop.id} className="grid scroll-mt-24 items-center gap-8 lg:grid-cols-2 lg:gap-16">
      <Reveal className={stop.flip ? "lg:order-2" : undefined}>
        <Mono className="text-muted-foreground/70">{stop.eyebrow}</Mono>
        <h2 className="mt-3 max-w-[18ch] text-[1.75rem] leading-[1.12] font-semibold tracking-[-0.02em] text-balance sm:text-[2.25rem]">
          {stop.title}
        </h2>
        <p className="mt-4 max-w-[46ch] text-[0.9375rem] leading-relaxed text-pretty text-muted-foreground">
          {stop.body}
        </p>
        <a
          href={stop.href}
          className="mt-6 inline-block rounded-sm text-[0.875rem] font-medium text-foreground transition-colors duration-200 hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
        >
          Learn more ›
        </a>
      </Reveal>
      <Reveal delay={120} className={stop.flip ? "lg:order-1" : undefined}>
        <Frame img={stop.img} alt={stop.alt} />
      </Reveal>
    </article>
  );
}

export function Tour() {
  return (
    <Band id="graph" className="border-t-0">
      <Container className="flex flex-col gap-24 py-20 lg:gap-32 lg:py-28">
        {TOUR.map((stop) => (
          <Stop key={stop.id} stop={stop} />
        ))}
      </Container>
    </Band>
  );
}
