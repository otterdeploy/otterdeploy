/**
 * Access card: who is allowed to create an account on this installation.
 *
 * Invitation-only is the default and the safe answer for an internet-facing
 * install. Open registration is a deliberate opt-in, and it never grants
 * installation-admin: the owner is minted once, by the installer's bootstrap
 * token, and nothing on this page can hand that authority to a visitor.
 */

import type { OrganizationId } from "@otterdeploy/shared/id";
import { UserAdd01Icon } from "@hugeicons/core-free-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { SettingsRow, SettingsSection } from "@/shared/components/settings-section";
import { Switch } from "@/shared/components/ui/switch";
import { orpc, queryClient } from "@/shared/server/orpc";

export function AccessCard({ organizationId }: { organizationId: OrganizationId }) {
  const query = useQuery(
    orpc.organization.getAccessSettings.queryOptions({ input: { organizationId } }),
  );

  const save = useMutation({
    ...orpc.organization.setAccessSettings.mutationOptions(),
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({
        queryKey: orpc.organization.getAccessSettings.queryKey({ input: { organizationId } }),
      });
      toast.success(
        data.registrationMode === "open"
          ? "Anyone can now create an account"
          : "Account creation is invitation-only",
      );
    },
    onError: (err) => toast.error(err.message ?? "Failed to save access settings"),
  });

  const open = query.data?.registrationMode === "open";

  return (
    <SettingsSection
      icon={UserAdd01Icon}
      title="Access"
      description="Who may create an account on this installation. Applies to every workspace."
    >
      <SettingsRow
        title="Allow public registration"
        description={
          open
            ? "On. Anyone who can reach the sign-in page can create an account. New accounts join as ordinary members with no workspace until invited to one."
            : "Off. An account can only be created from a pending invitation. Recommended for any installation reachable from the internet."
        }
        control={
          <Switch
            checked={open}
            disabled={save.isPending || query.isLoading}
            onCheckedChange={(checked) =>
              save.mutate({
                organizationId,
                registrationMode: checked ? "open" : "invite-only",
              })
            }
          />
        }
      />
      {query.data?.bootstrapComplete === false && (
        <SettingsRow
          title="Installation not set up yet"
          description="No account exists, so the sign-in page is still showing the one-time bootstrap form and this setting has no effect until the first account is created."
          control={null}
        />
      )}
    </SettingsSection>
  );
}
