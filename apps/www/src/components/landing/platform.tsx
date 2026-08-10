import { PlatformDiagram } from "./platform-diagram";
import { Band, Container, Field, Mono } from "./primitives";

/**
 * The one-picture fold: sources on the left, the platform in the middle, live
 * endpoints on the right, and the three things it stands on underneath.
 *
 * It earns its space by answering the question a feature list can't: "what IS
 * this thing": in about two seconds.
 */
export function Platform() {
  return (
    <Band id="platform">
      <Container className="py-16 lg:py-20">
        <Field className="px-5 py-10 sm:px-10 sm:py-12 lg:px-14">
          <div className="mx-auto max-w-[46rem] text-center">
            <Mono className="text-muted-foreground">one platform</Mono>
            <h2 className="mt-3 text-[1.75rem] leading-[1.15] font-semibold tracking-[-0.03em] text-balance text-foreground sm:text-[2.125rem]">
              A repo goes in. A running, routed, backed-up service comes out.
            </h2>
            <p className="mx-auto mt-4 max-w-[52ch] text-[0.9375rem] leading-relaxed text-pretty text-muted-foreground">
              Build, edge, data, logs, previews and backups are one install on machines you own, not
              six services you wire together and then maintain.
            </p>
          </div>

          <div className="mx-auto mt-10 max-w-[52rem]">
            <PlatformDiagram />
          </div>
        </Field>
      </Container>
    </Band>
  );
}
