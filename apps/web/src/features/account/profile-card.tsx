/**
 * Profile — display name + avatar, saved via better-auth's `updateUser`.
 * Email is shown read-only: this install doesn't enable better-auth's
 * `user.changeEmail` flow (packages/auth/src/index.ts has no `user` block),
 * so an editable field would be a lie. Avatar is a URL (the user model's
 * `image` column) — there's no upload pipeline, and the hint says so.
 */

import { useState } from "react";

import { UserCircleIcon } from "@hugeicons/core-free-icons";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { SettingsFooter, SettingsSection } from "@/shared/components/settings-section";
import { Avatar, AvatarFallback, AvatarImage } from "@/shared/components/ui/avatar";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";

import { useAuthInvalidate, useCurrentSession } from "./data/use-account";

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function ProfileCard() {
  const router = useRouter();
  const invalidate = useAuthInvalidate();
  const sessionQ = useCurrentSession();
  const user = sessionQ.data?.user;

  // null = untouched, so a background session refetch doesn't clobber typing.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [imageDraft, setImageDraft] = useState<string | null>(null);

  const currentName = user?.name ?? "";
  const currentImage = user?.image ?? "";
  const name = nameDraft ?? currentName;
  const image = imageDraft ?? currentImage;
  const dirty = name.trim() !== currentName || image.trim() !== currentImage;

  const save = useMutation({
    mutationFn: async () => {
      const res = await authClient.updateUser({
        name: name.trim(),
        image: image.trim() === "" ? null : image.trim(),
      });
      if (res.error) throw new Error(res.error.message ?? "Failed to update profile");
    },
    onSuccess: async () => {
      setNameDraft(null);
      setImageDraft(null);
      await invalidate.session();
      // Refresh the router context so the sidebar identity block updates too.
      await router.invalidate();
      toast.success("Profile updated");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to update profile"),
  });

  return (
    <SettingsSection
      icon={UserCircleIcon}
      title="Profile"
      description="How you appear across this control plane."
    >
      <form
        className="flex flex-col gap-4 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty && name.trim() && !save.isPending) save.mutate();
        }}
      >
        <div className="flex items-center gap-3">
          <Avatar className="size-12">
            <AvatarImage src={image || undefined} alt={name} />
            <AvatarFallback className="text-sm">{initialsOf(name || "?")}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium">{currentName || "—"}</div>
            <div className="truncate font-mono text-[11.5px] text-muted-foreground">
              {user?.email ?? "…"}
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="account-name" className="text-[12px] text-muted-foreground">
              Display name
            </Label>
            <Input
              id="account-name"
              value={name}
              autoComplete="name"
              disabled={sessionQ.isPending || save.isPending}
              onChange={(e) => setNameDraft(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="account-email" className="text-[12px] text-muted-foreground">
              Email
            </Label>
            <Input
              id="account-email"
              value={user?.email ?? ""}
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
            disabled={sessionQ.isPending || save.isPending}
            onChange={(e) => setImageDraft(e.target.value)}
            className="font-mono text-[13px]"
          />
          <p className="text-[11px] text-muted-foreground">
            A public image URL — uploads aren't supported yet. Leave blank for initials.
          </p>
        </div>
        {/* Hidden submit so Enter in any field submits the form. */}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
      <SettingsFooter>
        <Button
          type="button"
          size="sm"
          disabled={!dirty || !name.trim() || save.isPending || sessionQ.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </SettingsFooter>
    </SettingsSection>
  );
}
