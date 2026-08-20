import { COMPARE_COLUMNS, COMPARE_ROWS, type CompareMark } from "./content";
import { Band, Container, cx, Mono, TwoTone } from "./primitives";

/**
 * The comparison a visitor was going to run in a second tab anyway, done here
 * with the candor that makes it credible: competitors get real wins, `partial`
 * is used generously in their favour, and our column earns its elevation by
 * being the only one that has to face the reader directly.
 *
 * Colour never travels alone (see StateChip): each mark is a dot AND a shape —
 * filled, hollow, or a dash — so the table survives greyscale and every kind
 * of colour-blindness.
 */

function Mark({ mark, column }: { mark: CompareMark; column: string }) {
  const label = { yes: "Yes", partial: "Partial", no: "No" }[mark];
  return (
    <span
      className="inline-grid size-5 place-items-center"
      role="img"
      aria-label={`${column}: ${label}`}
    >
      {mark === "yes" ? (
        <span className="size-2.5 rounded-full bg-primary" />
      ) : mark === "partial" ? (
        <span className="size-2.5 rounded-full border-[1.5px] border-muted-foreground" />
      ) : (
        <span className="h-[1.5px] w-2.5 rounded-full bg-border" />
      )}
    </span>
  );
}

export function Compare() {
  return (
    <Band id="compare">
      <Container className="py-16 lg:py-20">
        <div className="mx-auto max-w-[46rem] text-center">
          <TwoTone
            a="The table you'd have built in another tab."
            b="Wins conceded where they're due."
          />
          <p className="mx-auto mt-4 max-w-[52ch] text-[0.9375rem] leading-relaxed text-pretty text-muted-foreground">
            A hollow ring means the capability exists with wiring, plugins or caveats. Where we
            weren't certain, the mark went in the competitor's favour.
          </p>
        </div>

        <div className="od-noscroll mt-12 overflow-x-auto">
          <table className="w-full min-w-[44rem] border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="w-[38%] pb-3" aria-label="Capability" />
                {COMPARE_COLUMNS.map((col, i) => (
                  <th
                    key={col}
                    scope="col"
                    className={cx(
                      "pb-3 text-center",
                      i === 0 && "rounded-t-xl border-x border-t border-border bg-card pt-3",
                    )}
                  >
                    <Mono className={i === 0 ? "text-foreground" : "text-muted-foreground"}>
                      {col}
                    </Mono>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARE_ROWS.map((row, r) => (
                <tr key={row.label}>
                  <th
                    scope="row"
                    className="border-t border-border py-3 pr-4 text-left text-[0.8125rem] font-normal text-foreground"
                  >
                    {row.label}
                  </th>
                  {row.marks.map((mark, i) => (
                    <td
                      key={COMPARE_COLUMNS[i]}
                      className={cx(
                        "border-t border-border py-3 text-center",
                        i === 0 && "border-x bg-card",
                        i === 0 && r === COMPARE_ROWS.length - 1 && "rounded-b-xl border-b",
                      )}
                    >
                      <Mark mark={mark} column={COMPARE_COLUMNS[i]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-6 text-center font-mono text-[0.7rem] text-muted-foreground">
          projects move fast — spotted a stale mark? open an issue and we'll fix the row.
        </p>
      </Container>
    </Band>
  );
}
