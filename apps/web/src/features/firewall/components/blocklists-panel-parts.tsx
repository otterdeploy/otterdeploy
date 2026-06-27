import { useState } from "react";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { orpc } from "@/shared/server/orpc";

export function AddCustomForm({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const add = useMutation({
    ...orpc.firewall.blocklists.addCustom.mutationOptions(),
    onSuccess: () => {
      toast.success("List added — importing…");
      setName("");
      setUrl("");
      onAdded();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't add list"),
  });
  const valid = name.trim().length > 0 && /^https?:\/\//i.test(url.trim());
  return (
    <form
      className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) add.mutate({ name: name.trim(), url: url.trim() });
      }}
    >
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="List name"
        className="h-8 w-40 text-[12px]"
      />
      <Input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://example.com/blocklist.txt"
        className="h-8 min-w-0 flex-1 font-mono text-[12px]"
      />
      <Button type="submit" size="sm" disabled={!valid || add.isPending}>
        {add.isPending ? "Adding…" : "Add custom list"}
      </Button>
    </form>
  );
}

export function ConsoleEnrollCard() {
  const [key, setKey] = useState("");
  const [open, setOpen] = useState(false);
  const enroll = useMutation({
    ...orpc.firewall.console.enroll.mutationOptions(),
    onSuccess: (r) => {
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
      setKey("");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Enrollment failed"),
  });
  return (
    <Card className="flex flex-col gap-2 border-dashed p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-semibold">CrowdSec Console (optional)</h3>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Free account at{" "}
            <a
              href="https://app.crowdsec.net"
              target="_blank"
              rel="noreferrer"
              className="text-primary underline-offset-4 hover:underline"
            >
              app.crowdsec.net
            </a>{" "}
            — unlocks the larger community blocklist + curated lists. The public lists above need no
            account.
          </p>
        </div>
        {!open ? (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            Enroll
          </Button>
        ) : null}
      </div>
      {open ? (
        <form
          className="flex flex-wrap items-center gap-2 pt-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (key.trim()) enroll.mutate({ key: key.trim() });
          }}
        >
          <Input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Enrollment key from the console"
            className="h-8 min-w-0 flex-1 font-mono text-[12px]"
          />
          <Button type="submit" size="sm" disabled={key.trim().length < 8 || enroll.isPending}>
            {enroll.isPending ? "Enrolling…" : "Enroll"}
          </Button>
        </form>
      ) : null}
    </Card>
  );
}
