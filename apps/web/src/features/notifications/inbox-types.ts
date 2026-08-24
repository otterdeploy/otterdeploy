/**
 * The inbox row shape, derived from the oRPC contract rather than restated.
 *
 * Its own module so inbox-popover.tsx and inbox-row.tsx can both name it
 * without either importing the other.
 */

import { orpc } from "@/shared/server/orpc";

type InboxData = Awaited<ReturnType<typeof orpc.notifications.inbox.list.call>>;

export type InboxItem = InboxData["items"][number];
