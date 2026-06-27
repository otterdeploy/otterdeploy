import type { ReactNode } from "react";

import { useNavigate, useRouterState, useSearch } from "@tanstack/react-router";

import { Separator } from "@/components/ui/separator";
import { EnvSwitcherDropdown, type EnvName } from "@/features/env-switcher";

import { InnerRail } from "./inner-rail";
import { WorkspaceShell } from "./workspace-shell";

interface Props {
  projectId: string;
  projectName: string;
  children: ReactNode;
}

export function ProjectShell({ projectId, projectName, children }: Props) {
  const navigate = useNavigate();
  const location = useRouterState({ select: (s) => s.location.pathname });
  const search = useSearch({ strict: false }) as unknown as { env?: EnvName };
  const currentEnv: EnvName = (search.env ?? "development") as EnvName;

  const middle = (
    <div className="flex items-center gap-2">
      <span className="font-medium">{projectName}</span>
      <Separator orientation="vertical" className="h-4" />
      <EnvSwitcherDropdown
        current={currentEnv}
        onChange={(next) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          navigate({ search: (prev: any) => ({ ...prev, env: next }) } as any)
        }
      />
    </div>
  );

  return (
    <WorkspaceShell
      middle={middle}
      innerRail={<InnerRail projectId={projectId} currentHref={location} />}
    >
      {children}
    </WorkspaceShell>
  );
}
