import { Separator } from "@otterstack/ui/components/ui/separator";
import { SidebarTrigger } from "@otterstack/ui/components/ui/sidebar";

import { ModeToggle } from "@/components/mode-toggle";
import UserMenu from "@/components/user-menu";

import { BreadcrumbNav } from "./breadcrumb-nav";

export function DashboardHeader() {
  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
      <div className="flex items-center gap-2">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 h-4" />
        <BreadcrumbNav />
      </div>
      <div className="ml-auto flex items-center gap-2">
        <ModeToggle />
        <UserMenu />
      </div>
    </header>
  );
}
