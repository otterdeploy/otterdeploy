/**
 * Per-resource action checkboxes for an API key. An empty selection means a
 * full-access key (better-auth stores no permission restrictions). Owns the
 * toggle so callers just pass the current map + an onChange.
 */

import { Checkbox } from "@/shared/components/ui/checkbox";
import { Label } from "@/shared/components/ui/label";

import { API_SCOPES } from "./shared";

export function ScopePicker({
  value,
  onChange,
}: {
  value: Record<string, string[]>;
  onChange: (next: Record<string, string[]>) => void;
}) {
  const hasScopes = Object.keys(value).length > 0;

  // Add/remove an action; dropping a resource's last action removes it entirely.
  const toggle = (resource: string, action: string) => {
    const current = value[resource] ?? [];
    const next = current.includes(action)
      ? current.filter((a) => a !== action)
      : [...current, action];
    if (next.length === 0) {
      const { [resource]: _removed, ...rest } = value;
      onChange(rest);
      return;
    }
    onChange({ ...value, [resource]: next });
  };

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Label>Permissions</Label>
        <p className="text-[11px] text-muted-foreground">
          {hasScopes
            ? "This key is limited to the selected scopes."
            : "Leave all unchecked for a full-access key."}
        </p>
      </div>
      <div className="flex flex-col divide-y rounded-md border">
        {API_SCOPES.map((scope) => (
          <div
            key={scope.resource}
            className="flex items-center gap-3 px-3 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">{scope.label}</div>
              <div className="truncate text-[11px] text-muted-foreground">
                {scope.description}
              </div>
            </div>
            {/* Fixed two-column grid so every row's first action lines up
                under the next, regardless of how many actions it has. */}
            <div className="grid shrink-0 grid-cols-[5rem_5rem] gap-x-2">
              {scope.actions.map((action) => {
                const id = `scope-${scope.resource}-${action}`;
                const checked = (value[scope.resource] ?? []).includes(action);
                return (
                  <label
                    key={action}
                    htmlFor={id}
                    className="flex cursor-pointer items-center gap-1.5 text-[12px] text-muted-foreground select-none"
                  >
                    <Checkbox
                      id={id}
                      checked={checked}
                      onCheckedChange={() => toggle(scope.resource, action)}
                    />
                    {action}
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
