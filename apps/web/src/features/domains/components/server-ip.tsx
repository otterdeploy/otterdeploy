/**
 * The server's public IP, masked. The owner treats it as sensitive: an
 * installation admin can reveal or copy it; everyone else sees only the
 * mask, because the server never sent them the address in the first place.
 */

import { SensitiveValue } from "@/shared/components/sensitive-value";
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
        <SensitiveValue value={ip} label="server IP" />
      </div>
    );
  }
  if (hidden) {
    return (
      <SensitiveValue
        density="inline"
        label="server IP"
        restricted="Only installation admins can see the server IP"
        className={cn("text-[11px]", className)}
      />
    );
  }
  return <span className={cn("text-[11px] text-muted-foreground", className)}>not set</span>;
}
