import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/shared/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/shared/components/ui/sidebar";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  UnfoldMoreIcon,
  CommandIcon,
  CommandLineIcon,
  PaintBoardIcon,
  SunIcon,
  MoonIcon,
  ComputerIcon,
  LanguageCircleIcon,
  Settings01Icon,
  DeviceAccessIcon,
  ShieldKeyIcon,
  LogoutIcon,
} from "@hugeicons/core-free-icons";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useTheme } from "next-themes";
import { useTranslation } from "react-i18next";

import { useState } from "react";

import { setCommandPaletteOpen } from "@/features/command-palette";
import { authClient } from "@/lib/auth-client";
import { languageNames, supportedLngs } from "@otterdeploy/i18n";

import { ActiveSessionsDialog } from "./active-sessions-dialog";
import { ConnectCliDialog } from "./connect-cli-dialog";
import { TwoFactorDialog } from "./two-factor-dialog";

export interface User {
  name: string;
  initials: string;
  email: string;
  image: string;
}

const THEMES = [
  { value: "system", label: "System", icon: ComputerIcon },
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
] as const;

export function NavUser({ user }: { user: User }) {
  const { isMobile } = useSidebar();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const { orgSlug } = useParams({ strict: false }) as { orgSlug?: string };
  const [cliOpen, setCliOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [twoFactorOpen, setTwoFactorOpen] = useState(false);

  async function handleSignOut() {
    await authClient.signOut();
    void navigate({ to: "/sign-in", replace: true });
  }

  const currentLng = (
    i18n.resolvedLanguage ??
    i18n.language ??
    "en"
  ).split("-")[0] as (typeof supportedLngs)[number];

  return (
    <>
      <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="aria-expanded:bg-muted aria-expanded:text-foreground border border-border bg-secondary/40"
              />
            }
          >
            <Avatar>
              <AvatarImage src={user.image} alt={user.name} />
              <AvatarFallback>{user.initials}</AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{user.name}</span>
              <span className="truncate text-xs">{user.email}</span>
            </div>
            <HugeiconsIcon
              icon={UnfoldMoreIcon}
              strokeWidth={2}
              className="ml-auto size-4"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-60 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            {/* Identity */}
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar>
                  <AvatarImage src={user.image} alt={user.name} />
                  <AvatarFallback>{user.initials}</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{user.name}</span>
                  <span className="truncate text-xs">{user.email}</span>
                </div>
              </div>
            </DropdownMenuLabel>

            <DropdownMenuSeparator />

            {/* Command surface */}
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => setCommandPaletteOpen(true)}>
                <HugeiconsIcon icon={CommandIcon} strokeWidth={2} />
                Command menu
                <kbd className="ml-auto font-mono text-[11px] tracking-wider text-muted-foreground">
                  ⌘K
                </kbd>
              </DropdownMenuItem>
            </DropdownMenuGroup>

            <DropdownMenuSeparator />

            {/* Environment: appearance + language */}
            <DropdownMenuGroup>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <HugeiconsIcon icon={PaintBoardIcon} strokeWidth={2} />
                  Appearance
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="min-w-40">
                  <DropdownMenuRadioGroup
                    value={theme ?? "system"}
                    onValueChange={(v) => setTheme(v)}
                  >
                    {THEMES.map((o) => (
                      <DropdownMenuRadioItem key={o.value} value={o.value}>
                        <HugeiconsIcon icon={o.icon} strokeWidth={2} />
                        {o.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <HugeiconsIcon icon={LanguageCircleIcon} strokeWidth={2} />
                  {t("common.language")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="min-w-40">
                  <DropdownMenuRadioGroup
                    value={currentLng}
                    onValueChange={(lng) => {
                      void i18n.changeLanguage(lng);
                    }}
                  >
                    {supportedLngs.map((lng) => (
                      <DropdownMenuRadioItem key={lng} value={lng}>
                        {languageNames[lng]}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuGroup>

            <DropdownMenuSeparator />

            {/* Operator: account + machine access */}
            <DropdownMenuGroup>
              <DropdownMenuItem
                disabled={!orgSlug}
                onClick={() => {
                  if (orgSlug) {
                    void navigate({
                      to: "/$orgSlug/settings",
                      params: { orgSlug },
                    });
                  }
                }}
              >
                <HugeiconsIcon icon={Settings01Icon} strokeWidth={2} />
                {t("user.account")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setCliOpen(true)}>
                <HugeiconsIcon icon={CommandLineIcon} strokeWidth={2} />
                Connect CLI
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSessionsOpen(true)}>
                <HugeiconsIcon icon={DeviceAccessIcon} strokeWidth={2} />
                Active sessions
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTwoFactorOpen(true)}>
                <HugeiconsIcon icon={ShieldKeyIcon} strokeWidth={2} />
                Two-factor authentication
              </DropdownMenuItem>
            </DropdownMenuGroup>

            <DropdownMenuSeparator />

            <DropdownMenuItem onClick={() => void handleSignOut()}>
              <HugeiconsIcon icon={LogoutIcon} strokeWidth={2} />
              {t("user.logout")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
      </SidebarMenu>
      <ConnectCliDialog open={cliOpen} onOpenChange={setCliOpen} />
      <ActiveSessionsDialog
        open={sessionsOpen}
        onOpenChange={setSessionsOpen}
      />
      <TwoFactorDialog open={twoFactorOpen} onOpenChange={setTwoFactorOpen} />
    </>
  );
}
