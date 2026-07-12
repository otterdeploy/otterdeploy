/**
 * Sync tab — honest coming-soon surface. No sync-source backend exists yet
 * (Plan 7 follow-up), so every provider renders as not-connected with a
 * disabled Connect button; nothing here invents state.
 */
import { Link01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

interface SyncProvider {
  id: string;
  name: string;
  sub: string;
}

const SYNC_PROVIDERS: SyncProvider[] = [
  { id: "infisical", name: "Infisical", sub: "Open-source secret manager" },
  { id: "vault", name: "HashiCorp Vault", sub: "Self-hosted, dynamic secrets" },
  { id: "aws-sm", name: "AWS Secrets Manager", sub: "KMS-backed cloud secrets" },
  { id: "doppler", name: "Doppler", sub: "SaaS secret platform" },
  { id: "1password", name: "1Password Connect", sub: "Vault-based, audit-friendly" },
  { id: "gcp-sm", name: "Google Secret Manager", sub: "GCP-native" },
];

export function SyncIntegrations() {
  return (
    <div className="mx-auto w-full max-w-6xl p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">Sync sources</h2>
        <p className="text-xs text-muted-foreground">
          Pull secrets from an external manager into any environment. Changes flow one-way.
        </p>
      </div>

      <div className="mb-5 rounded-md border bg-card px-4 py-3">
        <div className="text-sm text-foreground/80">No sync sources connected.</div>
        <div className="text-xs text-muted-foreground">
          Provider integrations aren't available yet — they're on the roadmap.
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {SYNC_PROVIDERS.map((p) => (
          <ProviderCard key={p.id} p={p} />
        ))}
      </div>
    </div>
  );
}

function ProviderCard({ p }: { p: SyncProvider }) {
  return (
    <div className="flex flex-col gap-3 rounded-md border bg-card p-4">
      <div className="flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-md border bg-muted/30">
          <ProviderLogo id={p.id} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{p.name}</span>
            <Badge
              variant="outline"
              className="gap-1.5 font-mono text-[10px] text-muted-foreground"
            >
              <span className="size-1.5 rounded-full bg-muted-foreground/50" />
              not connected
            </Badge>
            <Badge variant="secondary" className="font-mono text-[10px]">
              Coming soon
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground">{p.sub}</div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" className="gap-1.5" disabled title="Coming soon">
          <HugeiconsIcon icon={Link01Icon} className="size-3" />
          Connect
        </Button>
      </div>
    </div>
  );
}

function ProviderLogo({ id }: { id: string }) {
  const base = "grid size-5 place-items-center rounded font-mono text-[10px] font-bold";
  if (id === "infisical") return <div className={cn(base, "bg-yellow-400 text-black")}>i</div>;
  if (id === "vault") return <div className={cn(base, "bg-black text-yellow-400")}>V</div>;
  if (id === "aws-sm") return <div className={cn(base, "bg-slate-900 text-orange-400 text-[8px]")}>aws</div>;
  if (id === "doppler") return <div className={cn(base, "bg-blue-600 text-white")}>D</div>;
  if (id === "1password") return <div className={cn(base, "rounded-full bg-blue-500 text-white")}>1</div>;
  if (id === "gcp-sm") return <div className={cn(base, "border border-blue-500 bg-white text-blue-500 text-[8px]")}>GCP</div>;
  return null;
}
