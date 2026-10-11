/**
 * The Command | SSH strip, bound to the URL. The active tab is read from the
 * matched child route (`staticData.view`), and choosing a tab navigates to the
 * other method's route, so the tab survives a reload and Back leaves the
 * dialog.
 */

import type { ReactNode } from "react";

import { CommandLineIcon, Key01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useNavigate, useParams } from "@tanstack/react-router";

import { Tabs, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { useRouteView } from "@/shared/hooks/use-route-view";

import { ADD_SERVER_METHODS, addServerMethod, methodLocation } from "./add-server-route";

const LABEL = { command: "Command", ssh: "SSH" } as const;
const ICON = { command: CommandLineIcon, ssh: Key01Icon } as const;

export function AddServerTabs({
  header,
  showList,
  children,
}: {
  /** The dialog's title block, set above the strip. */
  header?: ReactNode;
  /** The strip is the way in: it hides once a run has started, when switching
   *  method would only abandon it. */
  showList: boolean;
  /** One `TabsContent` per method. */
  children?: ReactNode;
}) {
  const method = addServerMethod(useRouteView());
  const { orgSlug } = useParams({ strict: false });
  const navigate = useNavigate();

  return (
    <Tabs
      value={method}
      onValueChange={(next) => {
        const target = ADD_SERVER_METHODS.find((m) => m === next);
        if (target && orgSlug) void navigate(methodLocation(orgSlug, target));
      }}
      className="gap-0"
    >
      <div className="flex flex-col gap-4 px-5 pt-5">
        {header}
        {showList ? (
          <TabsList
            variant="line"
            aria-label="How to add it"
            className="h-9 w-full justify-start gap-4 border-b p-0"
          >
            {ADD_SERVER_METHODS.map((m) => (
              <TabsTrigger key={m} value={m} className="flex-none px-0">
                <HugeiconsIcon icon={ICON[m]} strokeWidth={2} className="size-3.5" />
                {LABEL[m]}
              </TabsTrigger>
            ))}
          </TabsList>
        ) : null}
      </div>
      {children}
    </Tabs>
  );
}
