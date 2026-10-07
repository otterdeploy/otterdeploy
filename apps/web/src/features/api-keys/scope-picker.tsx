/**
 * Per-resource action checkboxes for a LIMITED API key. Only rendered when the
 * operator chose "Limited" access; full access is a separate, explicit choice
 * in the create dialog, so nothing here ever means "everything". Owns the
 * toggle so callers just pass the current map + an onChange.
 */

import { Checkbox } from "@/shared/components/ui/checkbox";

import { API_SCOPES } from "./shared";

export function ScopePicker({
  value,
  onChange,
}: {
  value: Record<string, string[]>;
  onChange: (next: Record<string, string[]>) => void;
}) {
  // Add/remove an action; dropping a resource's last action removes it entirely.
  const toggle = (resource: string, action: string) => {
    const current = value[resource] ?? [];
    const next = current.includes(action)
      ? current.filter((a) => a !== action)
      : [...current, action];
    if (next.length === 0) {
      const rest = { ...value };
      delete rest[resource];
      onChange(rest);
      return;
    }
    onChange({ ...value, [resource]: next });
  };

  return (
    <div className="flex flex-col divide-y rounded-md border">
      {API_SCOPES.map((scope) => {
        const selectedActions = new Set(value[scope.resource] ?? []);
        return (
          <fieldset key={scope.resource} className="flex flex-col gap-1.5 px-3 py-2.5">
            <legend className="sr-only">{scope.label}</legend>
            <div className="flex items-baseline gap-2">
              <span className="text-[13px] font-medium">{scope.label}</span>
              <span className="truncate text-[11px] text-muted-foreground">
                {scope.description}
              </span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {scope.actions.map((action) => {
                const id = `scope-${scope.resource}-${action}`;
                return (
                  <label
                    key={action}
                    htmlFor={id}
                    className="flex cursor-pointer items-center gap-1.5 font-mono text-[12px] text-muted-foreground select-none"
                  >
                    <Checkbox
                      id={id}
                      checked={selectedActions.has(action)}
                      onCheckedChange={() => toggle(scope.resource, action)}
                    />
                    {action}
                  </label>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}
