import type { ReactNode } from "react";

import { FirewallIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Card } from "@/shared/components/ui/card";

/** Empty state shown when the CrowdSec agent hasn't been switched on. */
export function FirewallDisabledCard() {
  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      <Card className="border-dashed p-5">
        <div className="flex items-start gap-4">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <HugeiconsIcon icon={FirewallIcon} strokeWidth={1.8} className="size-4.5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[13px] font-semibold">Firewall isn't enabled</h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              The CrowdSec agent ships with otterdeploy — it just stays off until you switch it on.
              Two steps:
            </p>
            <ol className="mt-3 space-y-2.5 text-[13px]">
              <li className="flex gap-2.5">
                <SetupStep n={1} />
                <span className="text-muted-foreground">
                  Set <CodeChip>CROWDSEC_BOUNCER_KEY</CodeChip> to a strong secret and{" "}
                  <CodeChip>CROWDSEC_LAPI_URL=http://crowdsec:8080</CodeChip>
                </span>
              </li>
              <li className="flex gap-2.5">
                <SetupStep n={2} />
                <span className="text-muted-foreground">
                  Start the bundled agent:{" "}
                  <CodeChip>docker compose --profile firewall up -d</CodeChip>
                </span>
              </li>
            </ol>
            <p className="mt-3 text-[12px] text-muted-foreground/80">
              The edge gate wires in automatically — no Caddy rebuild. Phase 1 enforces the
              community IP blocklist.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}

function CodeChip({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px] text-foreground/90">
      {children}
    </code>
  );
}

function SetupStep({ n }: { n: number }) {
  return (
    <span className="mt-px flex size-4.5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
      {n}
    </span>
  );
}
