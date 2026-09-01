/**
 * The inbox shapes, derived from the oRPC contract rather than restated.
 *
 * Their own module so inbox-popover.tsx, inbox-row.tsx and the card can all
 * name them without importing each other.
 */

import { orpc } from "@/shared/server/orpc";

type InboxData = Awaited<ReturnType<typeof orpc.notifications.inbox.list.call>>;

/** One settled row. */
export type InboxItem = InboxData["items"][number];

/** One thing that still needs attention, as the server derived it. */
export type OpenCondition = InboxData["open"][number];
