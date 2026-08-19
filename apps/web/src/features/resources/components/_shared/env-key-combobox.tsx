/**
 * The KEY input of a variables row, upgraded to an autocomplete when the
 * surrounding editor knows the service's image: known variables from the
 * env catalog (features/resources/env-catalog) surface as you type, with
 * their descriptions, and picking one can prefill a default value and mark
 * the row sensitive. Free text always wins — the catalog is suggestions,
 * not validation, and unknown keys type through exactly like a plain input.
 */
import { LockKeyIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { matchEnvSuggestions, type EnvSuggestion } from "@/features/resources/env-catalog";
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/shared/components/ui/combobox";

export function EnvKeyCombobox({
  value,
  suggestions,
  takenKeys,
  onChange,
  onPick,
  placeholder = "KEY",
  className,
  invalid,
}: {
  value: string;
  suggestions: EnvSuggestion[];
  /** Keys other rows already use: suggesting them again would only mint the
   *  duplicate-key error the editors exist to prevent. */
  takenKeys: ReadonlySet<string>;
  onChange: (key: string) => void;
  onPick: (suggestion: EnvSuggestion) => void;
  placeholder?: string;
  className?: string;
  invalid?: boolean;
}) {
  const matches = matchEnvSuggestions(suggestions, value, takenKeys);
  return (
    <Combobox
      items={matches}
      inputValue={value}
      // item-press is dropped: the pick below already writes the key (plus
      // default value + secret flag) in ONE update. Letting the fill-on-press
      // input event through would issue a second write built from a stale
      // form snapshot that clobbers the first (TanStack Form defers store
      // writes within a tick).
      onInputValueChange={(v, details) => {
        if (details.reason === "item-press") return;
        onChange(String(v));
      }}
      // Selection stays UNCONTROLLED on purpose: a pick here is an action
      // (fill the row), not state to hold. Controlling `value` to null makes
      // Base UI treat every press as selecting an already-current value and
      // it never fires onValueChange.
      onValueChange={(picked: EnvSuggestion | null) => {
        if (picked) onPick(picked);
      }}
      itemToStringLabel={(s: EnvSuggestion) => s.key}
      // Ranking lives in matchEnvSuggestions (prefix before substring);
      // Base UI's own filter would re-filter the already-filtered list.
      filter={null}
      openOnInputClick
      autoHighlight
    >
      <ComboboxInput
        placeholder={placeholder}
        showTrigger={false}
        className={className}
        spellCheck={false}
        aria-invalid={invalid || undefined}
      />
      {matches.length > 0 && (
        <ComboboxContent className="min-w-72">
          <ComboboxList>
            {(s: EnvSuggestion) => (
              <ComboboxItem key={s.key} value={s} className="items-start py-1.5">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 font-mono text-[12px] font-medium">
                    {s.key}
                    {s.secret && (
                      <HugeiconsIcon
                        icon={LockKeyIcon}
                        strokeWidth={2}
                        className="size-3 text-muted-foreground"
                        aria-label="Marked sensitive when picked"
                      />
                    )}
                    {s.required && (
                      <span className="text-[9.5px] tracking-wide text-warning uppercase">
                        required
                      </span>
                    )}
                  </span>
                  <span className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                    {s.description}
                  </span>
                </div>
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      )}
    </Combobox>
  );
}
