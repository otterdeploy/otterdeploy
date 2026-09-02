import { Band, Container } from "../landing/primitives";
import { CompareBlock } from "./compare";
import { ContrastBlock } from "./contrast";

/**
 * The comparison chapter. Two tables — the manual way you replace, then the
 * tools you replace — read as one argument: a single band, a shared ambient
 * glow underneath both, and a fading bridge between them instead of the dead
 * gap and hard hairline they used to sit across.
 */

function Bridge() {
  return (
    <Container className="py-4">
      <div className="relative flex items-center justify-center py-10">
        <div className="absolute inset-x-0 top-1/2 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
        <span className="relative rounded-full border border-border bg-background px-4 py-1.5 font-mono text-[0.6875rem] tracking-tight text-muted-foreground">
          now, against the other tools
        </span>
      </div>
    </Container>
  );
}

export function StacksUp() {
  return (
    <Band id="compare" className="relative overflow-hidden">
      {/* One soft glow spanning both tables, so the chapter reads as a region
          rather than two stacked slabs. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-0">
        <div
          className="absolute top-[18%] left-1/2 h-[46rem] w-[68rem] -translate-x-1/2 rounded-full"
          style={{
            background: "radial-gradient(closest-side, rgba(61,123,251,0.06), transparent)",
          }}
        />
      </div>
      <div className="relative z-10">
        <ContrastBlock />
        <Bridge />
        <CompareBlock />
      </div>
    </Band>
  );
}
