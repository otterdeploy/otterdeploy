import { useEffect, useMemo, useState } from "react";

import { Badge } from "@otterstack/ui/components/ui/badge";
import { Button } from "@otterstack/ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@otterstack/ui/components/ui/card";
import { Input } from "@otterstack/ui/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@otterstack/ui/components/ui/native-select";

import {
  parseResourceKind,
  parseResourceStatus,
  type ResourceKind,
  type ResourceNode,
  type ResourceStatus,
  resourceKinds,
  resourceStatuses,
} from "./types";

type DetailsPanelProps = {
  selectedNode: ResourceNode | null;
  onUpdateNode: (input: {
    nodeId: string;
    name: string;
    kind: ResourceKind;
    status: ResourceStatus;
  }) => Promise<void>;
  onDeleteNode: (nodeId: string) => Promise<void>;
};

export function DetailsPanel({ selectedNode, onUpdateNode, onDeleteNode }: DetailsPanelProps) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ResourceKind>("web");
  const [status, setStatus] = useState<ResourceStatus>("unknown");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!selectedNode) {
      return;
    }

    setName(selectedNode.data.name);
    setKind(selectedNode.data.kind);
    setStatus(selectedNode.data.status);
  }, [selectedNode]);

  const changed = useMemo(() => {
    if (!selectedNode) {
      return false;
    }

    return (
      name !== selectedNode.data.name ||
      kind !== selectedNode.data.kind ||
      status !== selectedNode.data.status
    );
  }, [kind, name, selectedNode, status]);

  if (!selectedNode) {
    return (
      <div className="absolute right-5 top-20 z-20 hidden w-[320px] lg:block">
        <Card className="border-white/10 bg-[#101527]/95 text-white backdrop-blur">
          <CardHeader>
            <CardTitle className="text-sm">Resource Details</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-slate-400">
            Select a resource node to edit its name, type, and health status.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="absolute right-5 top-20 z-20 w-[320px]">
      <Card className="border-white/10 bg-[#101527]/95 text-white backdrop-blur">
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm">Resource Details</CardTitle>
            <Badge variant="outline" className="border-white/20 text-xs capitalize text-slate-300">
              {selectedNode.data.kind}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-slate-300" htmlFor="resource-name">
              Name
            </label>
            <Input
              id="resource-name"
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              className="border-white/20 bg-white/5 text-white"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-300" htmlFor="resource-kind">
              Kind
            </label>
            <NativeSelect
              id="resource-kind"
              value={kind}
              onChange={(event) => setKind(parseResourceKind(event.currentTarget.value, kind))}
              className="w-full"
            >
              {resourceKinds.map((value) => {
                return (
                  <NativeSelectOption key={value} value={value}>
                    {value}
                  </NativeSelectOption>
                );
              })}
            </NativeSelect>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-300" htmlFor="resource-status">
              Status
            </label>
            <NativeSelect
              id="resource-status"
              value={status}
              onChange={(event) =>
                setStatus(parseResourceStatus(event.currentTarget.value, status))
              }
              className="w-full"
            >
              {resourceStatuses.map((value) => {
                return (
                  <NativeSelectOption key={value} value={value}>
                    {value}
                  </NativeSelectOption>
                );
              })}
            </NativeSelect>
          </div>

          <div className="flex gap-2 pt-1">
            <Button
              className="flex-1"
              disabled={!changed || isSaving || name.trim().length === 0}
              onClick={async () => {
                if (!selectedNode) {
                  return;
                }

                setIsSaving(true);
                try {
                  await onUpdateNode({
                    nodeId: selectedNode.id,
                    name: name.trim(),
                    kind,
                    status,
                  });
                } finally {
                  setIsSaving(false);
                }
              }}
            >
              Save
            </Button>
            <Button
              variant="destructive"
              disabled={isSaving}
              onClick={async () => {
                if (!selectedNode) {
                  return;
                }

                setIsSaving(true);
                try {
                  await onDeleteNode(selectedNode.id);
                } finally {
                  setIsSaving(false);
                }
              }}
            >
              Delete
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
