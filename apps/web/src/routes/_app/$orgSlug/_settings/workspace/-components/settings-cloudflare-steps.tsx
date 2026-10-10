/**
 * The static half of the Cloudflare connect flow: the numbered-step chrome and
 * the two steps that happen on Cloudflare's side, before the operator has
 * anything to paste back.
 *
 * Split from ./settings-cloudflare so that file stays about the token and the
 * zone it resolves; nothing here holds form state.
 */

import { Button } from "@/shared/components/ui/button";

import { orpc } from "@/shared/server/orpc";

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/shared/components/ui/combobox";

/** One zone as Cloudflare reports it, derived from the list mutation so the
 *  picker can never drift from what the server actually returns. */
export type CloudflareZone = Awaited<
  ReturnType<typeof orpc.organization.cloudflareListZones.call>
>[number];



// Cloudflare API-token deep link. `permissionGroups` is the documented
// query param that pre-selects the scope on the create-token page; the
// user only has to pick the zone under "Zone Resources" and hit Create.
// We pass "Zone.DNS:Edit", the minimum scope auto-configure DNS needs.
// (Cloudflare doesn't offer OAuth for DNS, so this is as close to
// one-click as their dashboard allows.)
const CLOUDFLARE_TOKEN_TEMPLATE_URL =
  "https://dash.cloudflare.com/profile/api-tokens?permissionGroups=Zone.DNS%3AEdit&name=otterdeploy";

/** One step row. `gap-4` between the number and its text so the numerals read
 *  as a margin rail rather than a bullet crowding the sentence. */
export const STEP = "flex items-start gap-4";

export function StepNumber({ n }: { n: number }) {
  return (
    // size-6 with the 13px/relaxed line box centers the numeral on the first
    // line of its step without a magic `mt-`.
    <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted/60 font-mono text-[11px] font-semibold text-muted-foreground ring-1 ring-foreground/10">
      {n}
    </span>
  );
}

/** Steps 1 and 2: open Cloudflare with the scopes pre-filled, then create and
 *  copy the token there. Renders the bare <li>s so they stay children of the
 *  parent's <ol> and keep their numbering. */
export function TokenSetupSteps() {
  return (
    <>
      <li className={STEP}>
        <StepNumber n={1} />
        <div className="flex flex-1 flex-col items-start gap-3">
          <span>Open Cloudflare with the DNS scope pre-filled.</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              window.open(CLOUDFLARE_TOKEN_TEMPLATE_URL, "_blank", "noopener,noreferrer")
            }
          >
            Open Cloudflare →
          </Button>
        </div>
      </li>
      <li className={STEP}>
        <StepNumber n={2} />
        <span className="flex-1">
          Pick your zone under "Zone Resources", then click{" "}
          <strong className="font-medium text-foreground">Create Token</strong> and copy it.
        </span>
      </li>
    </>
  );
}

/**
 * The tail of step 3: pick which zone this token should manage.
 *
 * Only rendered once a token has resolved zones, and it belongs to the token
 * that produced it, which is why it is part of step 3 rather than a fourth
 * step. Lives here with the rest of the connect-flow markup so
 * settings-cloudflare.tsx stays about the mutations and form wiring; it was
 * the largest block in that file and pushed it over the line cap.
 *
 * Takes a value/onChange pair rather than the card's form object: the picker
 * owns one field, and threading the form's full generic type through a
 * presentational child breaks every time a field is added.
 */
export function ZonePicker({
  zones,
  value,
  onChange,
  saving,
}: {
  zones: CloudflareZone[] | undefined;
  value: string;
  onChange: (zoneId: string) => void;
  saving: boolean;
}) {
  if (!zones) return null;

  if (zones.length === 0) {
    return (
      <p className="text-[12px] text-muted-foreground">
        That token works, but it can't reach any zones. Check its scope covers the zone you want.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 pt-1">
      <label htmlFor="cf-zone" className="text-[12px] font-medium text-foreground">
        Zone
      </label>
      {/* Searchable rather than a native select: a Cloudflare account can
          carry hundreds of zones, and scrolling a flat list for one domain is
          the wrong affordance. */}
      <Combobox
        items={zones}
        value={zones.find((z) => z.id === value) ?? null}
        onValueChange={(zone: CloudflareZone | null) => onChange(zone?.id ?? "")}
        itemToStringLabel={(zone: CloudflareZone) => zone.name}
        isItemEqualToValue={(a: CloudflareZone, b: CloudflareZone) => a.id === b.id}
        disabled={saving}
      >
        <ComboboxInput
          id="cf-zone"
          placeholder="Search your zones…"
          className="h-9 w-full"
          disabled={saving}
        />
        <ComboboxContent>
          <ComboboxEmpty>No zone matches.</ComboboxEmpty>
          <ComboboxList>
            {(zone: CloudflareZone) => (
              <ComboboxItem key={zone.id} value={zone} className="text-[13px]">
                <span className="min-w-0 flex-1 truncate">{zone.name}</span>
                {/* Cloudflare reports zones that aren't serving yet
                    ("pending"), worth seeing before you pick one and wonder
                    why DNS never applies. */}
                {zone.status !== "active" && (
                  <span className="shrink-0 text-[11px] text-muted-foreground">{zone.status}</span>
                )}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
}
