import { useState } from "react";

import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { orpc } from "@/shared/server/orpc";

const customListValid = (v: { name: string; url: string }) =>
  v.name.trim().length > 0 && /^https?:\/\//i.test(v.url.trim());

export function AddCustomForm({ onAdded }: { onAdded: () => void }) {
  const form = useForm({
    defaultValues: { name: "", url: "" },
    onSubmit: ({ value }) => {
      if (customListValid(value)) add.mutate({ name: value.name.trim(), url: value.url.trim() });
    },
  });
  const add = useMutation({
    ...orpc.firewall.blocklists.addCustom.mutationOptions(),
    onSuccess: () => {
      toast.success("List added — importing…");
      form.reset();
      onAdded();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't add list"),
  });
  return (
    <form
      className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="name">
        {(field) => (
          <Input
            value={field.state.value}
            onBlur={field.handleBlur}
            onChange={(e) => field.handleChange(e.target.value)}
            placeholder="List name"
            className="h-8 w-40 text-[12px]"
          />
        )}
      </form.Field>
      <form.Field name="url">
        {(field) => (
          <Input
            value={field.state.value}
            onBlur={field.handleBlur}
            onChange={(e) => field.handleChange(e.target.value)}
            placeholder="https://example.com/blocklist.txt"
            className="h-8 min-w-0 flex-1 font-mono text-[12px]"
          />
        )}
      </form.Field>
      <form.Subscribe selector={(s) => customListValid(s.values)}>
        {(valid) => (
          <Button type="submit" size="sm" disabled={!valid || add.isPending}>
            {add.isPending ? "Adding…" : "Add custom list"}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}

export function ConsoleEnrollCard() {
  const [open, setOpen] = useState(false);
  const form = useForm({
    defaultValues: { key: "" },
    onSubmit: ({ value }) => {
      if (value.key.trim()) enroll.mutate({ key: value.key.trim() });
    },
  });
  const enroll = useMutation({
    ...orpc.firewall.console.enroll.mutationOptions(),
    onSuccess: (r) => {
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
      form.reset();
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
            void form.handleSubmit();
          }}
        >
          <form.Field name="key">
            {(field) => (
              <Input
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="Enrollment key from the console"
                className="h-8 min-w-0 flex-1 font-mono text-[12px]"
              />
            )}
          </form.Field>
          <form.Subscribe selector={(s) => s.values.key.trim().length < 8}>
            {(tooShort) => (
              <Button type="submit" size="sm" disabled={tooShort || enroll.isPending}>
                {enroll.isPending ? "Enrolling…" : "Enroll"}
              </Button>
            )}
          </form.Subscribe>
        </form>
      ) : null}
    </Card>
  );
}
