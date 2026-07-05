/**
 * Public IP card — the address behind every sslip.io fallback domain and the
 * Cloudflare A records auto-configure writes. Detected on first boot in
 * production; this card makes it visible and correctable (NAT, multi-homed,
 * wrong echo answer). When env SERVER_IP pins it, editing is disabled — the
 * env value re-applies on every boot and would silently win.
 */

import { useState } from "react";
import { GlobalIcon } from "@hugeicons/core-free-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { SettingsSection } from "@/shared/components/settings-section";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { orpc, queryClient } from "@/shared/server/orpc";

export function ServerIpCard({ organizationId }: { organizationId: never }) {
  const query = useQuery(orpc.organization.getServerIp.queryOptions({ input: { organizationId } }));
  const save = useMutation({
    ...orpc.organization.setServerIp.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.organization.getServerIp.queryKey({ input: { organizationId } }),
      });
      toast.success("Public IP saved");
    },
    onError: (err) => toast.error(err.message ?? "Failed to save public IP"),
  });

  const [value, setValue] = useState<string | null>(null);
  const current = query.data?.serverIp ?? "";
  const envOverride = query.data?.envOverride ?? false;
  const displayed = value ?? current;
  const dirty = displayed.trim() !== current;

  return (
    <SettingsSection
      icon={GlobalIcon}
      title="Public IP"
      description={
        <>
          The address this server is reachable at from the internet. It anchors the{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11.5px]">
            &lt;name&gt;.&lt;ip&gt;.sslip.io
          </code>{" "}
          fallback domains every resource gets before you own a real domain, and it's what
          Cloudflare auto-configure points A records at. Auto-detected on first boot in
          production — correct it here if detection got it wrong (NAT, multi-homed host).
        </>
      }
    >
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] font-medium">Server IP</span>
          {envOverride && (
            <span className="inline-flex items-center rounded-sm border border-border/60 bg-muted px-2 py-0.5 font-mono text-[10px] font-medium uppercase text-muted-foreground">
              ENV OVERRIDE
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="text"
            placeholder="203.0.113.10"
            value={displayed}
            onChange={(e) => setValue(e.target.value)}
            disabled={envOverride || save.isPending || query.isLoading}
            className="font-mono text-[13px]"
          />
          <Button
            type="button"
            size="sm"
            disabled={envOverride || !dirty || save.isPending}
            onClick={() => save.mutate({ organizationId, serverIp: displayed.trim() })}
          >
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
        {envOverride && (
          <div className="text-[11.5px] text-muted-foreground">
            Pinned by the <code className="font-mono">SERVER_IP</code> environment variable — it
            re-applies on every boot, so edits here wouldn't stick. Change or unset the env var to
            manage it from this page.
          </div>
        )}
      </div>
    </SettingsSection>
  );
}
