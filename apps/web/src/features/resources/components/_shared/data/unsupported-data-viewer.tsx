/**
 * Data-tab fallback for engines the workbench cannot serve.
 *
 * Now only ClickHouse: it has a complete SQL dialect that compiles correct
 * statements, but no wire driver, so routing it to the workbench would give a
 * surface that fails the moment it opens. Postgres and MariaDB share the
 * workbench; Redis and MongoDB have their own views, because pretending a
 * keyspace or a document store is a table is worse than saying so.
 *
 * The Terminal tab remains the escape hatch.
 */

import { Database01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { DATABASE_ENGINES, type DatabaseEngine } from "@otterdeploy/shared/database-engines";

import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/components/ui/empty";

export function UnsupportedDataViewer({ engine }: { engine: DatabaseEngine }) {
  const label = DATABASE_ENGINES[engine]?.label ?? engine;

  return (
    <Empty className="rounded-md border border-dashed bg-muted/20 py-12">
      <EmptyHeader>
        <HugeiconsIcon
          icon={Database01Icon}
          strokeWidth={1.5}
          className="size-10 text-muted-foreground/50"
        />
        <EmptyTitle>Data viewer doesn’t support {label} yet</EmptyTitle>
        <EmptyDescription>
          Browsing data in the dashboard is available for PostgreSQL and Redis. For {label}, use the
          Terminal tab to connect with the engine’s own client.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
