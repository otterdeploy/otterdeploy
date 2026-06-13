/**
 * Notifications page — channel list + event subscription matrix. Ported from
 * the design demo; runs on local seed state until a channels backend exists.
 */

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";

import { AddChannelDialog } from "./add-channel-dialog";
import { ChannelCard } from "./channel-card";
import { SubscriptionMatrix } from "./subscription-matrix";
import {
  type Channel,
  type ChannelStatus,
  CHANNELS_SEED,
  DEFAULT_SUBS,
} from "./shared";

export function NotificationsPage() {
  const [channels, setChannels] = useState<Channel[]>(CHANNELS_SEED);
  const [subs, setSubs] = useState<Record<string, Set<string>>>(() => {
    const out: Record<string, Set<string>> = {};
    for (const c of CHANNELS_SEED) out[c.id] = new Set(DEFAULT_SUBS[c.id] ?? []);
    return out;
  });
  const [addOpen, setAddOpen] = useState(false);

  const toggleSub = (channelId: string, eventId: string) =>
    setSubs((s) => {
      const next = { ...s };
      const set = new Set(next[channelId] ?? []);
      if (set.has(eventId)) set.delete(eventId);
      else set.add(eventId);
      next[channelId] = set;
      return next;
    });

  const setChannelStatus = (id: string, status: ChannelStatus) =>
    setChannels((cs) => cs.map((c) => (c.id === id ? { ...c, status } : c)));

  const removeChannel = (id: string) => {
    setChannels((cs) => cs.filter((c) => c.id !== id));
    setSubs((s) => {
      const next = { ...s };
      delete next[id];
      return next;
    });
  };

  const addChannel = (c: Channel) => {
    setChannels((cs) => [...cs, c]);
    setSubs((s) => ({ ...s, [c.id]: new Set() }));
    setAddOpen(false);
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[15px] font-semibold tracking-tight">
            Notifications
          </h1>
          <p className="text-[12.5px] text-muted-foreground">
            Routes deploy, build, health, and security events to your channels.
          </p>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
          Add channel
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        {channels.map((c) => (
          <ChannelCard
            key={c.id}
            channel={c}
            onTest={(ch) => toast.success(`Test event queued to ${ch.name}`)}
            onEdit={() => toast.info("Channel editing isn't wired up yet")}
            onPause={(ch) =>
              setChannelStatus(
                ch.id,
                ch.status === "paused" ? "active" : "paused",
              )
            }
            onDelete={(ch) => removeChannel(ch.id)}
          />
        ))}
      </div>

      <SubscriptionMatrix
        channels={channels}
        subs={subs}
        onToggle={toggleSub}
      />

      <AddChannelDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdd={addChannel}
      />
    </div>
  );
}
