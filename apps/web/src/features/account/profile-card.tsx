/**
 * Profile — display name + avatar, saved via better-auth's `updateUser`.
 * Email is shown read-only: this install doesn't enable better-auth's
 * `user.changeEmail` flow (packages/auth/src/index.ts has no `user` block),
 * so an editable field would be a lie. Avatar is a URL (the user model's
 * `image` column) — there's no upload pipeline, and the hint says so.
 */

import { UserCircleIcon } from "@hugeicons/core-free-icons";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { SettingsFooter, SettingsSection } from "@/shared/components/settings-section";
import { Button } from "@/shared/components/ui/button";

import { authKeys, useCurrentSession } from "./data/use-account";
import { ProfileFields, ProfileIdentity } from "./profile-form-fields";

/** The `updateUser` mutation — `onSaved` resets the form on success. */
function useSaveProfile({ onSaved }: { onSaved: () => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, image }: { name: string; image: string }) => {
      const res = await authClient.updateUser({
        name: name.trim(),
        image: image.trim() === "" ? null : image.trim(),
      });
      if (res.error) throw new Error(res.error.message ?? "Failed to update profile");
    },
    onSuccess: async () => {
      onSaved();
      await queryClient.invalidateQueries({ queryKey: authKeys.currentSession });
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

  const currentName = user?.name ?? "";
  const currentImage = user?.image ?? "";

  // Defaults follow the session only while the form is untouched — once the
  // user types, useForm stops re-applying them, so a background session
  // refetch doesn't clobber typing. Saving resets the form back to untouched.
  const form = useForm({
    defaultValues: { name: currentName, image: currentImage },
    onSubmit: ({ value }) => {
      const dirty = value.name.trim() !== currentName || value.image.trim() !== currentImage;
      if (dirty && value.name.trim() && !save.isPending) save.mutate(value);
    },
  });

  const save = useSaveProfile({ onSaved: () => form.reset() });

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
          void form.handleSubmit();
        }}
      >
        <form.Field name="name">
          {(nameField) => (
            <form.Field name="image">
              {(imageField) => (
                <>
                  <ProfileIdentity
                    name={nameField.state.value}
                    image={imageField.state.value}
                    currentName={currentName}
                    email={user?.email}
                  />
                  <ProfileFields
                    name={nameField.state.value}
                    image={imageField.state.value}
                    email={user?.email}
                    disabled={busy}
                    onNameChange={nameField.handleChange}
                    onImageChange={imageField.handleChange}
                  />
                </>
              )}
            </form.Field>
          )}
        </form.Field>
        {/* Hidden submit so Enter in any field submits the form. */}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
      <SettingsFooter>
        <form.Subscribe
          selector={(s) =>
            (s.values.name.trim() !== currentName || s.values.image.trim() !== currentImage) &&
            s.values.name.trim().length > 0
          }
        >
          {(canSave) => (
            <Button
              type="button"
              size="sm"
              disabled={!canSave || busy}
              onClick={() => void form.handleSubmit()}
            >
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          )}
        </form.Subscribe>
      </SettingsFooter>
    </SettingsSection>
  );
}
