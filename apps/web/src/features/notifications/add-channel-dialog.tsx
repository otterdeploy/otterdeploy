/**
 * Add a notification channel. Channel type is picked from a pill row; the
 * field set below adapts to the selected kind. With no channels backend yet
 * this just appends to local state — the "Send test" button is a no-op stub.
 */

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { FlashIcon } from "@hugeicons/core-free-icons";

import { SvglLogo } from "@/shared/components/brand/svgl-logo";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { cn } from "@/shared/lib/utils";

import { ChannelFields, PLACEHOLDERS } from "./channel-fields";
import { type Channel, type ChannelKind, KIND_META } from "./shared";

interface AddChannelDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAdd: (c: Channel) => void;
}

export function AddChannelDialog({
  open,
  onOpenChange,
  onAdd,
}: AddChannelDialogProps) {
  const [kind, setKind] = useState<ChannelKind>("slack");
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");

  const submit = () => {
    const meta = PLACEHOLDERS[kind];
    onAdd({
      id: "ch_" + Math.random().toString(36).slice(2, 8),
      name: name || meta.name,
      kind,
      target: target || meta.target,
      transport: meta.transport,
      events7d: 0,
      lastDelivery: "never",
      status: "active",
    });
    setName("");
    setTarget("");
    setKind("slack");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Add notification channel</DialogTitle>
          <DialogDescription>
            Otterdeploy delivers a synthetic{" "}
            <span className="font-mono text-foreground">test.ping</span> event so
            you can confirm the wiring before subscribing it to real events.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label className="text-[11px] text-muted-foreground">
              Channel type
            </Label>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(KIND_META) as ChannelKind[]).map((k) => {
                const active = kind === k;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    className={cn(
                      "flex items-center gap-2 rounded-md border px-2.5 py-2 text-[12px] transition-colors",
                      active
                        ? "border-foreground bg-muted"
                        : "border-border hover:bg-muted/50",
                    )}
                  >
                    <SvglLogo
                      search={KIND_META[k].search}
                      fallback={KIND_META[k].label}
                      size={20}
                    />
                    <span>{KIND_META[k].label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="channel-name">Display name</Label>
            <Input
              id="channel-name"
              placeholder={PLACEHOLDERS[kind].name}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <ChannelFields kind={kind} target={target} setTarget={setTarget} />
        </div>

        <DialogFooter className="sm:justify-between">
          <Button variant="outline" type="button">
            <HugeiconsIcon icon={FlashIcon} strokeWidth={2} className="size-3.5" />
            Send test
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              type="button"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="button" onClick={submit}>
              Save channel
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
