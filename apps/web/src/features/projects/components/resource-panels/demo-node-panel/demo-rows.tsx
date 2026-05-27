/**
 * Demo placeholder rows used by the demo node panel — single-deploy row
 * and single-env row. Both intentionally minimal; will be deleted along
 * with the demo cluster when real per-section editors ship for service
 * resources.
 */

import { cn } from "@/shared/lib/utils";

export function DeployRow({
  commit,
  message,
  age,
  author,
}: {
  commit: string;
  message: string;
  age: string;
  author: string;
}) {
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="text-foreground">{commit}</span>
        <span className="text-muted-foreground">· {age}</span>
      </div>
      <p className="mt-1 font-sans text-[13px] text-foreground">{message}</p>
      <p className="font-sans text-xs text-muted-foreground">by {author}</p>
    </div>
  );
}

export function EnvRow({
  name,
  value,
  secret,
}: {
  name: string;
  value: string;
  secret?: boolean;
}) {
  return (
    <div className="grid grid-cols-[180px_1fr] items-baseline gap-3 border-b border-border/40 py-2">
      <span className="text-foreground/80">{name}</span>
      <span
        className={cn(
          "truncate text-muted-foreground",
          secret && "rounded bg-muted px-1.5",
        )}
      >
        {secret ? "•".repeat(12) : value}
      </span>
    </div>
  );
}
