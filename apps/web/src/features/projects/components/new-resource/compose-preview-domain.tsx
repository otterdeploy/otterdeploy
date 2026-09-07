/**
 * The hostname a published port will answer on, attached to the container
 * that publishes it.
 *
 * It used to be a block of its own on the next step, which meant reading a
 * paragraph to learn something the service list already had the context for:
 * which port, on which container. Here the address sits directly under the
 * pill you clicked to publish it, and reads as the URL it will become.
 *
 * The FRONT DOOR (the first exposed port in the stack) is the stack's own
 * name; every other row derives a flat sibling of it and says so, until you
 * type into it.
 *
 * It animates BOTH ways, which is why it stays mounted when the port is
 * unpublished rather than being conditionally rendered: React unmounts
 * immediately, so an exit animation needs the element to still be there to
 * run one.
 *
 * The collapse is `max-height`, not the `grid-template-rows: 0fr → 1fr`
 * trick. That trick resolves the track to 0 in an auto-height container here
 * — forcing `1fr` inline still computed `0px` — so the row never opened. A
 * max-height cap works because this row is exactly one line: `ROW_MAX_PX` is
 * comfortably above its ~31px and only ever bounds the transition, never the
 * layout. `aria-hidden` + `inert` keep the closed row out of the
 * accessibility tree and off the tab order, so "invisible" is not merely
 * visual.
 */
import { useTranslation } from "react-i18next";

import { cn } from "@/shared/lib/utils";

/**
 * The open height the transition runs to.
 *
 * Just above the row's own ~31px, deliberately. A generous cap (64px) makes
 * the VISIBLE travel finish in about a fifth of the duration — height is
 * `min(content, max-height)`, so once max-height passes 31 nothing moves —
 * and the row appeared to snap. Tight to the content, the eased curve reads
 * across the whole 200ms.
 *
 * Safe because the row cannot wrap: every child is `shrink-0` except the
 * input, which is `min-w-0 flex-1`, so its height does not depend on width.
 */
const ROW_MAX_PX = 40;

import { type DomainRow, serviceOf } from "./stack-domains";

export function ComposePreviewDomain({
  row,
  port,
  isFront,
  open,
  onChange,
}: {
  row: DomainRow;
  port: number;
  /** The stack's own hostname: the rest are named after this one. */
  isFront: boolean;
  /** Is this port published? Drives the collapse, not the mount. */
  open: boolean;
  onChange: (domain: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      aria-hidden={!open}
      inert={!open}
      style={{ maxHeight: open ? ROW_MAX_PX : 0 }}
      className={cn(
        "overflow-hidden transition-[max-height,opacity] duration-200 ease-out",
        "motion-reduce:transition-none",
        open ? "opacity-100" : "opacity-0",
      )}
    >
      <div>
        <div className="flex items-center gap-2 border-t px-3 py-1.5">
          <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">
            :{port}
          </span>
          <span aria-hidden className="shrink-0 font-mono text-[11px] text-muted-foreground/50">
            →
          </span>
          {/* `https://` is not editable: the edge terminates TLS, so a hostname is
          the only part there is to choose. Showing it keeps the row reading as
          the URL it becomes rather than as a bare form field. */}
          <span className="shrink-0 font-mono text-[11.5px] text-muted-foreground/70">
            https://
          </span>
          <input
            value={row.domain}
            onChange={(e) => onChange(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            aria-label={t(isFront ? "compose.domainLabel" : "compose.domainFor", {
              service: serviceOf(row.key),
            })}
            placeholder={t("compose.domainPlaceholder")}
            className={cn(
              "min-w-0 flex-1 bg-transparent font-mono text-[11.5px] text-foreground outline-none",
              "placeholder:text-muted-foreground/50",
            )}
          />
          {!isFront && !row.custom && (
            <span className="shrink-0 font-mono text-[9.5px] tracking-wide text-muted-foreground/60 uppercase">
              {t("compose.domainDerived")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
