import { HugeiconsIcon } from "@hugeicons/react";
import { UnfoldMoreIcon, PlusSignIcon } from "@hugeicons/core-free-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@otterstack/ui/components/ui/dropdown-menu";
import {
  SidebarMenuButton,
  useSidebar,
} from "@otterstack/ui/components/ui/sidebar";

import { authClient } from "@/lib/auth-client";
import { queryClient } from "@/utils/orpc";

export function OrgSwitcher() {
  const { isMobile } = useSidebar();
  const { data: orgs } = authClient.useListOrganizations();
  const { data: activeOrg } = authClient.useActiveOrganization();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <SidebarMenuButton
            size="lg"
            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
          />
        }
      >
        <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg text-xs font-bold">
          {activeOrg?.name?.charAt(0).toUpperCase() ?? "O"}
        </div>
        <div className="grid flex-1 text-left text-sm leading-tight">
          <span className="truncate font-semibold">
            {activeOrg?.name ?? "Select org"}
          </span>
        </div>
        <HugeiconsIcon icon={UnfoldMoreIcon} strokeWidth={2} className="ml-auto size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
        align="start"
        side={isMobile ? "bottom" : "right"}
        sideOffset={4}
      >
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Organizations
        </DropdownMenuLabel>
        {orgs?.map((org) => (
          <DropdownMenuItem
            key={org.id}
            onClick={() => {
              authClient.organization.setActive({ organizationId: org.id });
              queryClient.invalidateQueries();
            }}
            className="gap-2 p-2"
          >
            <div className="flex size-6 items-center justify-center rounded-sm border text-xs font-bold">
              {org.name.charAt(0).toUpperCase()}
            </div>
            {org.name}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="gap-2 p-2">
          <div className="flex size-6 items-center justify-center rounded-md border bg-background">
            <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="size-4" />
          </div>
          <div className="font-medium text-muted-foreground">Create org</div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
