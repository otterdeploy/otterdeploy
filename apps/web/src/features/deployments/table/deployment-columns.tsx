/**
 * The deployments feed's columns.
 *
 * What this replaces: `deployments-table.tsx` (a shadcn `<Table>` with its own
 * pager), `deployments-toolbar.tsx` (five hand-wired selects), the four-card
 * stat strip, and `deployments-search.ts`'s bespoke URL schema — all of which
 * the shell already provides, and provides once.
 *
 * SCOPE: this is the project-wide Deployments page. The per-resource history
 * inside a service panel stays as it is — it is a short, always-complete list
 * of one service's deploys read beside its logs, not a feed, and putting a
 * filter sidebar and a histogram over eleven rows would be worse for it.
 *
 * What a reader scans, in order: did it work, which service, what shipped, why.
 * Everything after that is there for the person who has already found the row.
 */

import type { DataTableColumn } from "@/shared/components/data-table/schema/types";

import {
  DeploymentAuthor,
  DeploymentDuration,
  DeploymentResource,
  DeploymentStatus,
  type DeploymentRow,
} from "@/features/deployments/table/deployment-cells";
import { DeploymentShipped } from "@/features/deployments/table/deployment-shipped";
import { CLOCK_WIDTH, EmptyCell } from "@/shared/components/data-table/cells";

export const deploymentColumns: readonly DataTableColumn<DeploymentRow>[] = [
  {
    key: "createdAt",
    label: "Started",
    kind: "instant",
    // A clock, not "3m ago": deploys land in bursts seconds apart, and five
    // rows all reading "2m ago" cannot be put in order by eye.
    display: { type: "clock" },
    sortable: true,
    width: CLOCK_WIDTH,
    filter: { type: "timerange", defaultOpen: true, commandDisabled: true },
  },
  {
    key: "status",
    label: "Status",
    kind: "enum",
    width: 170,
    // State and elapsed time are one sentence — see `DeploymentStatus`.
    cell: ({ row }) => <DeploymentStatus row={row} />,
    filter: { type: "checkbox", defaultOpen: true },
    sheet: { label: "Status" },
  },
  {
    key: "outcome",
    label: "Outcome",
    kind: "enum",
    /**
     * FILTER only. The Status column already prints the exact status, and a
     * second column saying "failed" beside "crashed" would be the same fact
     * twice — but "show me everything that broke" is one click here and two
     * checkboxes there, and it is the click everyone makes first.
     *
     * Derived, so the feed maps this key to a SQL expression rather than a
     * column (see `ColumnMap` in packages/api/src/lib/table/sql.ts). The row
     * carries the same value, so the client evaluator and the WHERE clause
     * still agree.
     */
    filterOnly: true,
    filter: {
      type: "checkbox",
      defaultOpen: true,
      // Declared rather than faceted: all four are always CHOICES even in a
      // window that happens to hold none of one, and "failed 0" is a more
      // useful thing to read than a missing row.
      options: [
        { label: "succeeded", value: "succeeded" },
        { label: "in flight", value: "in flight" },
        { label: "cancelled", value: "cancelled" },
        { label: "failed", value: "failed" },
      ],
    },
  },
  {
    key: "resourceName",
    label: "Resource",
    kind: "string",
    width: 170,
    filter: { type: "checkbox", defaultOpen: true },
    // Carries the `current` marker — see `DeploymentResource` for why that is
    // the most easily-lost bit on the page.
    cell: ({ row }) => <DeploymentResource row={row} />,
  },
  {
    key: "environmentName",
    label: "Env",
    kind: "enum",
    display: { type: "code" },
    width: 92,
    // Beside the resource, not off at the far end, because it is what tells two
    // rows apart when it has to: a service and its staging twin carry the same
    // NAME, and `web · running · current` twice with nothing between them is a
    // table lying about which one is live. On a single-environment project the
    // column reads uniform and the column menu is right there.
    filter: { type: "checkbox" },
  },
  {
    key: "shipped",
    label: "Shipped",
    kind: "string",
    // The widest column, and the one the eye lands in: a commit message is how
    // a person recognises the deploy they are looking for.
    minWidth: 260,
    accessor: (row) => row.gitCommitMessage ?? row.gitSha ?? row.image,
    cell: ({ row }) => <DeploymentShipped row={row} />,
    sheet: { label: "Shipped" },
  },
  {
    key: "errorMessage",
    label: "Error",
    kind: "string",
    // Visible, not hidden, and not folded into Shipped. A red dot with no words
    // is what sends you clicking into three rows to find out which one broke,
    // and a column that is blank on the good rows costs nothing to skim past.
    minWidth: 180,
    cell: ({ row }) =>
      row.errorMessage === null ? (
        <EmptyCell />
      ) : (
        <span
          className="block truncate font-mono text-[11px] text-destructive/90"
          title={row.errorMessage}
        >
          {row.errorMessage}
        </span>
      ),
    // The full text, on its own, in the sheet: a stack trace is a block, not a
    // value in a label/value row.
    sheet: { label: "Error", block: true },
  },
  {
    key: "reason",
    label: "Trigger",
    kind: "enum",
    display: { type: "code" },
    width: 108,
    filter: { type: "checkbox", defaultOpen: true },
  },
  {
    key: "gitCommitAuthor",
    label: "Author",
    kind: "string",
    // The avatar is the point: a face is recognised in a fraction of the time a
    // name is read, which is what you want in a column you are scanning rather
    // than reading. The server already sends the URL — see `DeploymentAuthor`.
    width: 150,
    filter: { type: "checkbox" },
    cell: ({ row }) => <DeploymentAuthor row={row} />,
  },
  {
    key: "resourceKind",
    label: "Type",
    kind: "enum",
    display: { type: "badge" },
    width: 96,
    hidden: true,
    filter: { type: "checkbox" },
  },
  {
    key: "durationMs",
    label: "Took",
    kind: "number",
    // `number` for the ALIGNMENT it brings — the column trails right, which is
    // what makes a stack of durations comparable at a glance. The cell is
    // custom because the raw milliseconds are not what anyone reads, and
    // because an in-flight row has to count up rather than print a value.
    display: { type: "number" },
    width: 92,
    sortable: true,
    cell: ({ row }) => <DeploymentDuration row={row} />,
    // "Which deploys took over five minutes" is a question about the build, not
    // about a row, and it is the one that finds a slow Dockerfile.
    filter: { type: "slider", min: 0, max: 900_000 },
    sheet: { label: "Took", render: (row) => <DeploymentDuration row={row} /> },
  },
  {
    key: "gitRef",
    label: "Branch",
    kind: "string",
    display: { type: "code" },
    width: 130,
    hidden: true,
    filter: { type: "checkbox" },
  },
  {
    key: "image",
    label: "Image",
    kind: "string",
    display: { type: "code" },
    minWidth: 200,
    hidden: true,
  },
  {
    key: "gitSha",
    label: "Commit",
    kind: "string",
    display: { type: "code" },
    width: 110,
    hidden: true,
  },
  {
    key: "completedAt",
    label: "Finished",
    kind: "instant",
    display: { type: "clock" },
    width: CLOCK_WIDTH,
    hidden: true,
    sortable: true,
    // No custom cell: `ClockCell` already renders a null as the empty dash.
  },
  {
    key: "isLatest",
    label: "Newest for resource",
    kind: "boolean",
    display: { type: "boolean" },
    width: 96,
    hidden: true,
    // The filter that answers "what is running right now, everywhere" — pair it
    // with outcome=succeeded and the table becomes the fleet's current state.
    filter: { type: "checkbox" },
  },
  {
    key: "q",
    label: "Search",
    kind: "string",
    filterOnly: true,
    filter: {
      type: "search",
      keys: ["resourceName", "gitSha", "gitCommitMessage", "gitCommitAuthor", "image"],
    },
  },
];
