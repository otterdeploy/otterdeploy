/**
 * The Locations card's List / Map switch, shared by both planes' country
 * cards. A segmented control in the header: the active segment lifts onto
 * the card surface with a hairline ring, never a filled accent.
 */

import { useTranslation } from "react-i18next";

export type LocationsMode = "list" | "map";

export function ListMapToggle({
  mode,
  onChange,
}: {
  mode: LocationsMode;
  onChange: (next: LocationsMode) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center rounded-md bg-muted p-0.5 text-xs" role="tablist">
      {(["list", "map"] as const).map((value) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={mode === value}
          onClick={() => onChange(value)}
          className={
            mode === value
              ? "rounded-[5px] bg-background px-2 py-0.5 font-medium shadow-none ring-1 ring-foreground/10"
              : "rounded-[5px] px-2 py-0.5 text-muted-foreground transition-colors hover:text-foreground"
          }
        >
          {t(value === "list" ? "analytics.overview.listMode" : "analytics.overview.mapMode")}
        </button>
      ))}
    </div>
  );
}
