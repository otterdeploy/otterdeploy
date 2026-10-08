/**
 * The "Self-signed" chip for a surface that only knows a hostname. Renders
 * nothing unless the project's route for that host is served without ACME
 * (see features/projects/data/self-signed-hosts), so callers can drop it next
 * to any public URL they offer.
 */

import { useIsSelfSigned } from "@/features/projects/data/self-signed-hosts";
import { SelfSignedBadge } from "@/shared/components/domains/self-signed-badge";

export function SelfSignedMark({ host, className }: { host: string; className?: string }) {
  const selfSigned = useIsSelfSigned(host);
  return selfSigned ? <SelfSignedBadge className={className} /> : null;
}
