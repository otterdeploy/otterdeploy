/**
 * The servers a key signs in to, as a hairline list inside the rotate and
 * delete dialogs: state mark, name, role, and a right-hand slot the dialog
 * fills (what will happen, what did happen, or a link to the server).
 */

import type { ReactNode } from "react";

import type { KeyServer } from "./data/use-key-servers";

import { ServerStateMark } from "./server-chip";

export function ServerList({
  servers,
  right,
}: {
  servers: KeyServer[];
  right: (server: KeyServer) => ReactNode;
}) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg ring-1 ring-foreground/10">
      {servers.map((s) => (
        <li key={s.serverId} className="flex min-h-9 items-center gap-2.5 px-3 py-2 text-[13px]">
          <ServerStateMark server={s} size="md" />
          <span className="font-mono text-[12.5px]">{s.name}</span>
          <span className="text-xs text-muted-foreground">{s.role}</span>
          <span className="ml-auto flex min-w-0 items-center gap-1 text-right text-xs">
            {right(s)}
          </span>
        </li>
      ))}
    </ul>
  );
}
