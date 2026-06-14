/**
 * Data-tab fallback for database engines the viewer doesn't natively support
 * yet (MariaDB, MongoDB). We deliberately do NOT fall back to the Postgres SQL
 * console here — showing a relational studio over a non-relational engine is
 * worse than honest: it just errors on every query. Instead we say plainly
 * that the engine isn't supported. The Terminal tab remains the escape hatch.
 */

import { HugeiconsIcon } from "@hugeicons/react";
import { Database01Icon } from "@hugeicons/core-free-icons";

import { DATABASE_ENGINES, type DatabaseEngine } from "@otterdeploy/shared/database-engines";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/shared/components/ui/empty";

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
          Browsing data in the dashboard is available for PostgreSQL and Redis.
          For {label}, use the Terminal tab to connect with the engine’s own
          client.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
