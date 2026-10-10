/**
 * The server's public IP, masked. The owner treats it as sensitive: an
 * installation admin can reveal or copy it (the webhook SecretReveal
 * pattern); everyone else sees only the mask, because the server never sent
 * them the address in the first place.
 */

import { SecretReveal } from "@/features/webhooks/secret-reveal";
import { cn } from "@/shared/lib/utils";

export function ServerIp({
  ip,
  hidden,
  className,
}: {
  /** Present for installation admins only. */
  ip: string | null;
  /** An address exists, but this viewer may not see it. */
  hidden: boolean;
  className?: string;
}) {
  if (ip) {
    return (
      <div className={cn("w-44", className)}>
        <SecretReveal fetchSecret={() => Promise.resolve(ip)} label="server IP" />
      </div>
    );
  }
  if (hidden) {
    return (
      <span
        className={cn("font-mono text-[11px] text-muted-foreground", className)}
        title="Only installation admins can see the server IP"
      >
        ••••••••
        <span className="sr-only">Server IP, visible to installation admins only</span>
      </span>
    );
  }
  return <span className={cn("text-[11px] text-muted-foreground", className)}>not set</span>;
}
