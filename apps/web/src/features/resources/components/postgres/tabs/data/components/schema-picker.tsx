/**
 * Which schema the rail lists.
 *
 * A combobox, not a select: a database with dozens of schemas (one per
 * workspace, one per tenant) needs a filter, and the popup is wide enough to
 * show a whole name where the rail's trigger has to truncate it. Only
 * rendered when there is a choice to make; a database whose tables all live
 * in `public` gains nothing from a one-option dropdown.
 */
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "@/shared/components/ui/combobox";

/** Sentinel: the combobox needs a non-empty value; "every schema" is `null` in state. */
const ALL_SCHEMAS = "__all__";

function labelOf(value: string): string {
  return value === ALL_SCHEMAS ? "all schemas" : value;
}

export function SchemaPicker({
  schemas,
  active,
  onChange,
}: {
  schemas: readonly string[];
  /** `null` is every schema. */
  active: string | null;
  onChange: (schema: string | null) => void;
}) {
  return (
    <div className="flex items-center gap-2 px-3 pt-2.5">
      <span className="shrink-0 text-[10px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
        Schema
      </span>
      <Combobox
        items={[ALL_SCHEMAS, ...schemas]}
        value={active ?? ALL_SCHEMAS}
        onValueChange={(v) => {
          if (v !== null) onChange(v === ALL_SCHEMAS ? null : v);
        }}
        itemToStringLabel={labelOf}
      >
        <ComboboxTrigger
          className="flex h-6 min-w-0 flex-1 items-center justify-between gap-1 rounded-md px-1.5 font-mono text-[11px] hover:bg-muted/60 data-popup-open:bg-muted/60"
          title={labelOf(active ?? ALL_SCHEMAS)}
        >
          <span className="min-w-0 truncate">{labelOf(active ?? ALL_SCHEMAS)}</span>
        </ComboboxTrigger>
        <ComboboxContent className="w-72" align="end">
          <ComboboxInput
            showTrigger={false}
            placeholder="Search schemas…"
            className="font-mono text-[11.5px]"
          />
          <ComboboxEmpty>No schema matches.</ComboboxEmpty>
          <ComboboxList>
            {(v: string) => (
              <ComboboxItem key={v} value={v} className="font-mono text-[11px]">
                {labelOf(v)}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
}
