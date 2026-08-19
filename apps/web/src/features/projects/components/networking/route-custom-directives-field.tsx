/**
 * The raw-Caddyfile section of the route policy dialog (od-f4rb): a labeled
 * CaddyCodeEditor plus the inline rejection message from Caddy's /adapt
 * validation. Split out of route-directives-dialog so that file stays a
 * dialog + save shell.
 */

import { CaddyCodeEditor } from "@/features/projects/components/networking/caddy-code-editor";
import { Label } from "@/shared/components/ui/label";

export function CustomDirectivesField({
  value,
  onValueChange,
  error,
}: {
  value: string;
  onValueChange: (value: string) => void;
  /** Caddy's rejection message for the last save attempt, shown inline next
   *  to the editor rather than only as a toast: the user needs it while
   *  fixing the text. Null when the draft hasn't been rejected. */
  error: string | null;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="route-custom-directives">Custom directives</Label>
      <p className="text-xs text-muted-foreground">
        Raw Caddyfile lines for this site block. Validated against the live edge config before they
        apply; a rejected block is rolled back and never served.
      </p>
      <CaddyCodeEditor
        value={value}
        onValueChange={onValueChange}
        placeholder={'header X-Robots-Tag "noindex"'}
        className="max-h-56 min-h-28"
      />
      {error ? <p className="font-mono text-xs break-all text-destructive">{error}</p> : null}
    </div>
  );
}
