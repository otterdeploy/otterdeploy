/**
 * What a Flagged row lets you do about the address in it.
 *
 * Three things were wrong with what this replaces, and they were the same
 * thing: the action was a shared `useMutation`. Its one `isPending` disabled
 * the Block button on EVERY row while any single block was in flight, so a
 * table of eighty scanners could only be worked one address at a time, with the
 * whole column greyed out in between. A row that was already banned showed the
 * dead word "Blocked" with no way to undo it, even though the ban is trivially
 * reversible. And every block meant exactly thirty days, because the only place
 * a duration could be chosen was the manual popover in the header.
 *
 * Now: the write is a transaction over the decision collection, so it applies
 * locally on click (no pending state to share, nothing else disabled, rolls
 * back if the server refuses); a banned row offers Unblock in the same muted
 * vocabulary the Blocked tab uses; and the caret picks any ban length,
 * including permanent.
 */
import { useTranslation } from "react-i18next";

import { blockIps, unblockIp } from "../decisions";
import { BlockSplitButton } from "./block-split-button";

/** Red, and outlined rather than filled: blocking is destructive to somebody,
 *  but it is also the ordinary thing to do on this tab, so it must not shout
 *  once per row. */
const DESTRUCTIVE = "text-destructive hover:text-destructive";

export function FlaggedRowAction({ ip, banned }: { ip: string; banned: boolean }) {
  const { t } = useTranslation();

  // Same plain-text affordance as the Blocked tab's, deliberately: an address
  // that is already banned is not in a state anyone needs shouted at them, and
  // the word "Unblock" says the state as clearly as the word "Blocked" did.
  if (banned) {
    return (
      <button
        type="button"
        onClick={() => unblockIp(ip)}
        title={t("firewall.alreadyBanned")}
        className="text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        {t("firewall.unblock")}
      </button>
    );
  }

  return (
    <BlockSplitButton
      label={t("firewall.block")}
      menuLabel={t("firewall.blockForLength", { ip })}
      onBlock={(hours) => blockIps([ip], hours)}
    />
  );
}
