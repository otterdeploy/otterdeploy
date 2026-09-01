/**
 * The tags field: chips in a box, typed or picked.
 *
 * Suggestions are the org's existing tags, so a second person tagging a
 * connection "analytics" gets the same spelling as the first and the filter
 * strip in the switcher has two rows under one tag rather than one under
 * each of two. Anything else is typed and confirmed with Enter or a comma.
 *
 * A tag is canonicalised the moment it becomes a chip, with the same
 * `normalizeTag` the server applies, so what you see in the chip is exactly
 * what will be stored — and a tag the server would refuse is refused here,
 * with the reason, before it ever leaves the form.
 */
import { useState } from "react";

import { MAX_TAGS, normalizeTag } from "@otterdeploy/shared/data-tags";

import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from "@/shared/components/ui/combobox";
import { Label } from "@/shared/components/ui/label";

export function TagsField({
  tags,
  suggestions,
  onChange,
}: {
  tags: readonly string[];
  /** Canonical tags already in use across the org's connections. */
  suggestions: readonly string[];
  onChange: (tags: string[]) => void;
}) {
  const anchor = useComboboxAnchor();
  const [query, setQuery] = useState("");
  const [rejected, setRejected] = useState<string | null>(null);

  const full = tags.length >= MAX_TAGS;
  const available = suggestions.filter((s) => !tags.includes(s));
  const typed = query.trim();
  // A suggestion that continues what was typed is offered first, and Enter
  // takes it — Base UI's own behaviour. Only when nothing continues the
  // typed text does Enter create the tag instead.
  const continues = available.some((s) => s.startsWith(typed.toLowerCase()));

  const add = (raw: string) => {
    const tag = normalizeTag(raw);
    if (tag === null) {
      setRejected(raw.trim());
      return;
    }
    setRejected(null);
    setQuery("");
    if (!tags.includes(tag) && !full) onChange([...tags, tag]);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="conn-tags">
        Tags
        <span className="font-normal text-muted-foreground">optional</span>
      </Label>
      <Combobox
        multiple
        value={[...tags]}
        onValueChange={(next) => {
          setRejected(null);
          onChange(next);
        }}
        items={available}
        inputValue={query}
        onInputValueChange={setQuery}
        autoHighlight
      >
        <ComboboxChips ref={anchor}>
          <ComboboxValue>
            {(selected: readonly string[]) => (
              <>
                {selected.map((tag) => (
                  <ComboboxChip key={tag} className="font-mono text-[11px]">
                    {tag}
                  </ComboboxChip>
                ))}
                <ComboboxChipsInput
                  id="conn-tags"
                  disabled={full}
                  placeholder={
                    full ? `${MAX_TAGS} tags is the most` : selected.length === 0 ? "analytics" : ""
                  }
                  className="text-[13px]"
                  onKeyDown={(e) => {
                    if (e.key === "," && typed !== "") {
                      e.preventDefault();
                      add(typed);
                    } else if (e.key === "Enter" && typed !== "" && !continues) {
                      e.preventDefault();
                      add(typed);
                    }
                  }}
                />
              </>
            )}
          </ComboboxValue>
        </ComboboxChips>
        <ComboboxContent anchor={anchor}>
          <ComboboxEmpty>
            {typed === "" ? "Type a tag, then Enter or comma." : `Enter adds “${typed}”.`}
          </ComboboxEmpty>
          <ComboboxList>
            {(item: string) => (
              <ComboboxItem key={item} value={item} className="font-mono text-[12px]">
                {item}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      {rejected !== null ? (
        <p className="text-[11.5px] leading-snug text-destructive">
          “{rejected}” can’t be a tag — letters, digits, dots, dashes and underscores only.
        </p>
      ) : (
        <p className="text-[11.5px] leading-snug text-muted-foreground">
          Find it later by tag in the database switcher.
        </p>
      )}
    </div>
  );
}
