/**
 * Presentational pieces of the Profile card — the avatar identity row and the
 * name / email / avatar-URL inputs. All state stays in `ProfileCard`; these
 * only render the current values. Split out to keep that component's branch
 * count in check.
 */

import { Avatar, AvatarFallback, AvatarImage } from "@/shared/components/ui/avatar";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function ProfileIdentity({
  name,
  image,
  currentName,
  email,
}: {
  name: string;
  image: string;
  currentName: string;
  email: string | undefined;
}) {
  return (
    <div className="flex items-center gap-3">
      <Avatar className="size-12">
        <AvatarImage src={image || undefined} alt={name} />
        <AvatarFallback className="text-sm">{initialsOf(name || "?")}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium">{currentName || "—"}</div>
        <div className="truncate font-mono text-[11.5px] text-muted-foreground">{email ?? "…"}</div>
      </div>
    </div>
  );
}

export function ProfileFields({
  name,
  image,
  email,
  disabled,
  onNameChange,
  onImageChange,
}: {
  name: string;
  image: string;
  email: string | undefined;
  disabled: boolean;
  onNameChange: (value: string) => void;
  onImageChange: (value: string) => void;
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="account-name" className="text-[12px] text-muted-foreground">
            Display name
          </Label>
          <Input
            id="account-name"
            value={name}
            autoComplete="name"
            disabled={disabled}
            onChange={(e) => onNameChange(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="account-email" className="text-[12px] text-muted-foreground">
            Email
          </Label>
          <Input
            id="account-email"
            value={email ?? ""}
            readOnly
            disabled
            className="font-mono text-[13px]"
          />
          <p className="text-[11px] text-muted-foreground">
            Email changes aren't enabled on this install.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="account-avatar" className="text-[12px] text-muted-foreground">
          Avatar URL
        </Label>
        <Input
          id="account-avatar"
          type="url"
          placeholder="https://…"
          value={image}
          disabled={disabled}
          onChange={(e) => onImageChange(e.target.value)}
          className="font-mono text-[13px]"
        />
        <p className="text-[11px] text-muted-foreground">
          A public image URL — uploads aren't supported yet. Leave blank for initials.
        </p>
      </div>
    </>
  );
}
