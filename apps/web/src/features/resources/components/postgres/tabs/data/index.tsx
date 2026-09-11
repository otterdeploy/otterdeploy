/**
 * The database panel's "Data" tab: a doorway, not the workbench.
 *
 * It used to render the whole studio inside the resource panel, boxed at
 * `h-[calc(100dvh-20rem)]` with an "Open editor" button that threw a 100svh
 * `Dialog` over the app. That escape hatch was the admission that a side panel
 * is the wrong shape for writing SQL.
 *
 * What settled it was external connections: one is not attached to any
 * resource, so half of what the workbench can open has no panel to be opened
 * from. The workbench moved to `/$orgSlug/data`, and this tab became the link
 * that opens it already pointed at THIS database.
 *
 * The tab stays rather than disappearing because a database panel with no
 * mention of its data reads like something is missing, and because "how do I
 * connect to this" is a question people come to the panel to answer.
 */
import { ArrowRight01Icon, Database01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useParams } from "@tanstack/react-router";

import { Button } from "@/shared/components/ui/button";

import type { PostgresBodyProps } from "../../types";

import { resourceTarget, targetKey } from "./data/target";

interface DataTabBodyProps {
  resource: PostgresBodyProps["resource"];
}

/**
 * A doorway asks the database NOTHING.
 *
 * This used to read `useDataCapabilities(target)` to label itself EDITABLE or
 * READ-ONLY, which meant reading the schema, which for a managed database means
 * reaching it — and a managed database is reachable only through an open
 * session. The panel has no session and no business opening one, so every visit
 * to a database resource fired `data.schema` at a tunnel that wasn't there.
 *
 * The panel renders under `keepMounted`, so this happened on EVERY tab of the
 * panel, not just this one: opening a database from the graph produced a failed
 * request, an error toast, and a `failure` row in the audit log, before the
 * reader had asked for anything. The capability is a fact about a session; it
 * is stated in the workbench, where a session exists.
 */
export function DataTabBody({ resource }: DataTabBodyProps) {
  const target = resourceTarget(String(resource.resourceId));
  // Read from the URL rather than threaded through two panel layers: the org
  // slug is a fact about where we are, not about this resource.
  const { orgSlug } = useParams({ strict: false });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
        <div className="flex items-center gap-2 text-[13px]">
          <HugeiconsIcon
            icon={Database01Icon}
            strokeWidth={2}
            className="size-4 text-muted-foreground"
          />
          <span className="font-mono">{resource.databaseName}</span>
          <span className="text-muted-foreground/50">·</span>
          <span className="text-muted-foreground">{resource.engine}</span>
        </div>

        <p className="text-[13px] text-muted-foreground">
          Browse tables, run SQL and edit rows in the workbench. It opens pointed at this database,
          and you can switch to any other from there.
        </p>

        <div>
          {orgSlug === undefined ? null : (
            <Button
              size="sm"
              className="gap-1.5"
              render={
                <Link
                  to="/$orgSlug/data"
                  params={{ orgSlug }}
                  search={{ target: targetKey(target) }}
                />
              }
            >
              Browse data
              <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
