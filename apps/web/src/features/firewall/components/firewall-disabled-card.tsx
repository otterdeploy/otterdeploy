import type { ReactNode } from "react";

import { FirewallIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";

import { Card } from "@/shared/components/ui/card";

/**
 * Empty state shown when the CrowdSec agent isn't reachable and the bouncer
 * env isn't configured. od-5j8.11: a fresh install turns this on by
 * default (install.sh generates the bouncer key/LAPI wiring and starts the
 * agent automatically), seeing this card means either the agent is still
 * starting up, or the operator explicitly opted out
 * (OTTERDEPLOY_FIREWALL=false / --no-firewall).
 */
export function FirewallDisabledCard() {
  const { t } = useTranslation();
  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      <Card className="border-dashed p-5">
        <div className="flex items-start gap-4">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <HugeiconsIcon icon={FirewallIcon} strokeWidth={1.8} className="size-4.5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[13px] font-semibold">{t("firewall.notEnabled")}</h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              A fresh install turns CrowdSec on automatically. If you just installed, the agent may
              still be starting (this can take a few seconds after{" "}
              <CodeChip>docker compose up</CodeChip>). If you disabled it on purpose, here's how to
              turn it back on:
            </p>
            <ol className="mt-3 space-y-2.5 text-[13px]">
              <li className="flex gap-2.5">
                <SetupStep n={1} />
                <span className="text-muted-foreground">
                  Re-run the installer without <CodeChip>--no-firewall</CodeChip> (or set{" "}
                  <CodeChip>OTTERDEPLOY_FIREWALL=true</CodeChip>). It (re)generates{" "}
                  <CodeChip>CROWDSEC_BOUNCER_KEY</CodeChip> and{" "}
                  <CodeChip>CROWDSEC_LAPI_URL</CodeChip> and applies the host firewall baseline.
                </span>
              </li>
              <li className="flex gap-2.5">
                <SetupStep n={2} />
                <span className="text-muted-foreground">
                  Or manually: set those two env vars, then{" "}
                  <CodeChip>docker compose --profile firewall up -d</CodeChip>.
                </span>
              </li>
            </ol>
            <p className="mt-3 text-[12px] text-muted-foreground/80">
              The edge gate wires in automatically, with no Caddy rebuild. Enforces the community IP
              blocklist plus SSH/HTTP attack detection at both the edge and the host.
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
