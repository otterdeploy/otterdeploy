/**
 * "Data" tab for a MariaDB/MySQL resource — a read-only table browser.
 *
 * Unlike the Postgres SQL console this is deliberately a browser: a table list
 * on the left, a paginated row grid on the right. The server builds every
 * statement (no free-text SQL), so nothing here can write. The presentational
 * pieces (picker, row pane, pager) live in `./table-browser`.
 */
import { useState } from "react";

import type { PostgresBodyProps } from "../../../postgres/types";

import { useMariadbRows, useMariadbTables } from "./data/use-mariadb";
import { PAGE, RowPanel, TablePicker, type TableRef } from "./table-browser";

// Re-exported so the Mongo data tab can reuse the shared pager.
export { Pager } from "./table-browser";

export function MariadbDataTabBody({ resource }: { resource: PostgresBodyProps["resource"] }) {
  const resourceId = resource.resourceId;
  const tablesQuery = useMariadbTables(resourceId);
  const [selected, setSelected] = useState<TableRef | null>(null);
  const [offset, setOffset] = useState(0);

  const tables = tablesQuery.data?.tables ?? [];
  const active = selected ?? tables[0] ?? null;

  const rowsQuery = useMariadbRows({
    resourceId,
    schema: active?.schema ?? "",
    table: active?.name ?? "",
    limit: PAGE,
    offset,
    enabled: Boolean(active),
  });

  const pick = (t: TableRef) => {
    setSelected(t);
    setOffset(0);
  };

  return (
    <div className="flex min-h-0 gap-3" style={{ height: "60vh" }}>
      <TablePicker
        isLoading={tablesQuery.isLoading}
        isError={tablesQuery.isError}
        onRetry={() => void tablesQuery.refetch()}
        tables={tables}
        active={active}
        onPick={pick}
      />
      <RowPanel
        active={active}
        offset={offset}
        isLoading={rowsQuery.isLoading}
        isError={rowsQuery.isError}
        isFetching={rowsQuery.isFetching}
        hasMore={rowsQuery.data?.hasMore ?? false}
        columns={rowsQuery.data?.columns ?? []}
        rows={rowsQuery.data?.rows ?? []}
        onRetry={() => void rowsQuery.refetch()}
        onPrev={() => setOffset((o) => Math.max(0, o - PAGE))}
        onNext={() => setOffset((o) => o + PAGE)}
      />
    </div>
  );
}
