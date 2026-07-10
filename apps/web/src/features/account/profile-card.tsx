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
import { Button } from "@/shared/components/ui/button";

import { useAuthInvalidate, useCurrentSession } from "./data/use-account";
import { ProfileFields, ProfileIdentity } from "./profile-form-fields";

/** The `updateUser` mutation — `onSaved` clears the drafts on success. */
function useSaveProfile({
  name,
  image,
  onSaved,
}: {
  name: string;
  image: string;
  onSaved: () => void;
}) {
  const router = useRouter();
  const invalidate = useAuthInvalidate();
  return useMutation({
    mutationFn: async () => {
      const res = await authClient.updateUser({
        name: name.trim(),
        image: image.trim() === "" ? null : image.trim(),
      });
      if (res.error) throw new Error(res.error.message ?? "Failed to update profile");
    },
    onSuccess: async () => {
      onSaved();
      await invalidate.session();
      // Refresh the router context so the sidebar identity block updates too.
      await router.invalidate();
      toast.success("Profile updated");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to update profile"),
  });
}

export function ProfileCard() {
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

  const save = useSaveProfile({
    name,
    image,
    onSaved: () => {
      setNameDraft(null);
      setImageDraft(null);
    },
  });

  const busy = sessionQ.isPending || save.isPending;

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
        <ProfileIdentity name={name} image={image} currentName={currentName} email={user?.email} />
        <ProfileFields
          name={name}
          image={image}
          email={user?.email}
          disabled={busy}
          onNameChange={setNameDraft}
          onImageChange={setImageDraft}
        />
        {/* Hidden submit so Enter in any field submits the form. */}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
      <SettingsFooter>
        <Button
          type="button"
          size="sm"
          disabled={!dirty || !name.trim() || busy}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </SettingsFooter>
    </SettingsSection>
  );
}
