/**
 * Project custom domain. When set + verified, the project's services
 * land under it (`web.<customDomain>`) instead of falling through to
 * the org's baseDomain. Empty input clears back to org default.
 *
 * Verification is a separate flow (DNS TXT or CNAME); we just expose
 * the bound string here and reflect status. Saving a new value resets
 * verification — the operator has to re-prove ownership of the new
 * domain.
 */

import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { cn } from "@/shared/lib/utils";

interface DomainSectionProps {
  customDomain: string;
  verifiedAt: Date | null;
  onCustomDomainChange: (v: string) => void;
}

export function DomainSection(props: DomainSectionProps) {
  const trimmed = props.customDomain.trim();
  const status: "unset" | "pending" | "verified" =
    trimmed.length === 0 ? "unset" : props.verifiedAt ? "verified" : "pending";

  return (
    <section className="rounded-md border bg-card p-5">
      <header className="mb-3">
        <h2 className="text-[14px] font-semibold">Domain</h2>
        <p className="text-[12.5px] text-muted-foreground">
          Where this project's services land. Leave blank to fall back to
          the organization's default domain.
        </p>
      </header>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="proj-custom-domain">Custom domain</Label>
        <Input
          id="proj-custom-domain"
          value={props.customDomain}
          onChange={(e) => props.onCustomDomainChange(e.target.value)}
          placeholder="app.example.com"
          className="font-mono"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <StatusLine status={status} verifiedAt={props.verifiedAt} />
      </div>
    </section>
  );
}

function StatusLine({
  status,
  verifiedAt,
}: {
  status: "unset" | "pending" | "verified";
  verifiedAt: Date | null;
}) {
  if (status === "unset") {
    return (
      <p className="text-[11.5px] text-muted-foreground">
        Currently using the organization's default domain.
      </p>
    );
  }
  if (status === "verified") {
    return (
      <p className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
        <span className={cn("size-1.5 rounded-full", "bg-emerald-500")} />
        Verified
        {verifiedAt && ` · ${verifiedAt.toLocaleDateString()}`}
      </p>
    );
  }
  return (
    <p className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
      <span className={cn("size-1.5 rounded-full", "bg-amber-500")} />
      Pending verification — DNS check runs after Save.
    </p>
  );
}
