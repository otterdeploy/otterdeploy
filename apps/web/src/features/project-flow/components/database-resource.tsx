import { type Node, type NodeProps } from "@xyflow/react";
import { Clock, Globe, HardDrive, Network, Plus, RefreshCw, Trash2 } from "lucide-react";
import * as motion from "motion/react-client";
import type React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface VolumeAttachment {
  id: string;
  source: string;
  target: string;
}

export type DatabaseNode = {
  category: string;
  name: string;
  engine: string;
  status: "running" | "starting" | "stopped" | "missing" | "error";
  health: "healthy" | "unhealthy" | "starting" | null;
  publicHostname: string;
  internalHostname: string;
  volumes: VolumeAttachment[];
};

export type TDatabaseResource = Node<DatabaseNode, "database">;

export function DatabaseResource({
  id,
  data,
  selected,
}: NodeProps<TDatabaseResource>): React.ReactElement {
  const anchorName = `--db-${id}` as string;

  return (
    <div className="group relative flex flex-col items-center shadow-md">
      <motion.div
        whileTap={{ scale: 0.98 }}
        className="hit-area-x-4 hit-area-t-4"
        style={{ anchorName } as React.CSSProperties}
      >
        <div
          className={cn(
            "flex w-44 flex-col rounded-xl border bg-card px-3 py-3 shadow-sm transition-all",
            selected
              ? "border-amber-500/80 ring-2 ring-amber-500/40"
              : "border-border hover:border-foreground/20",
          )}
        >
          <div className="flex items-center gap-1.5 py-0.5">
            <PostgreSQLIcon />
            <span className="text-[11px] font-medium">{data.name}</span>
          </div>
          <p className="py-1 text-[9px] text-muted-foreground/70">
            {getStatusLabel(data.status, data.health)}
          </p>
          <div className="mt-1 grid gap-1.5 text-[9px] text-muted-foreground/80">
            <div className="flex items-center gap-1">
              <Globe className="size-2.5 shrink-0" />
              <span className="truncate">{data.publicHostname}</span>
            </div>
            <div className="flex items-center gap-1">
              <Network className="size-2.5 shrink-0" />
              <span className="truncate">{data.internalHostname}</span>
            </div>
          </div>
        </div>
      </motion.div>

      {data.volumes.map((volume) => (
        <div
          key={volume.id}
          className="first:pt-10 flex min-h-10 w-44 items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1.5 -mt-3"
        >
          <HardDrive className="size-3 shrink-0 text-muted-foreground" strokeWidth={2} />
          <span className="text-[10px] text-muted-foreground truncate">{volume.source}</span>
        </div>
      ))}

      <div className="absolute left-full top-1/2 -translate-y-1/2 ml-1.5 flex flex-col gap-0.5 opacity-0 -translate-x-1 pointer-events-none transition-all duration-150 group-hover:opacity-100 group-hover:translate-x-0 group-hover:pointer-events-auto">
        <ActionButton icon={<Plus className="size-2.5" strokeWidth={2} />} />
        <ActionButton icon={<Clock className="size-2.5" strokeWidth={2} />} />
        <ActionButton icon={<RefreshCw className="size-2.5" strokeWidth={2} />} />
        <ActionButton icon={<Trash2 className="size-2.5" strokeWidth={2} />} />
      </div>
    </div>
  );
}

function getStatusLabel(
  status: "running" | "starting" | "stopped" | "missing" | "error",
  health?: "healthy" | "unhealthy" | "starting" | null,
) {
  switch (status) {
    case "running":
      return health === "healthy" ? "Service is healthy" : "Service is running";
    case "starting":
      return "Service is starting";
    case "stopped":
      return "Service is stopped";
    case "missing":
      return "Service is missing";
    default:
      return "Service reported an error";
  }
}

function ActionButton({ icon, onClick }: { icon: React.ReactNode; onClick?: () => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={onClick}
      className="nodrag nopan size-4! rounded-sm hit-area-2 before:hidden"
    >
      {icon}
    </Button>
  );
}

const PostgreSQLIcon = () => (
  <svg className="size-4" viewBox="0 0 432.071 445.383">
    <g
      fillRule="nonzero"
      clipRule="nonzero"
      fill="none"
      stroke="#fff"
      strokeWidth="12.4651"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeMiterlimit="4"
    >
      <path
        d="M323.205 324.227c2.833-23.601 1.984-27.062 19.563-23.239l4.463.392c13.517.615 31.199-2.174 41.587-7 22.362-10.376 35.622-27.7 13.572-23.148-50.297 10.376-53.755-6.655-53.755-6.655 53.111-78.803 75.313-178.836 56.149-203.322-52.27-66.789-142.748-35.206-144.262-34.386l-.482.089c-9.938-2.062-21.06-3.294-33.554-3.496-22.761-.374-40.032 5.967-53.133 15.904 0 0-161.408-66.498-153.899 83.628 1.597 31.936 45.777 241.655 98.47 178.31 19.259-23.163 37.871-42.748 37.871-42.748 9.242 6.14 20.307 9.272 31.912 8.147l.897-.765c-.281 2.876-.157 5.689.359 9.019-13.572 15.167-9.584 17.83-36.723 23.416-27.457 5.659-11.326 15.734-.797 18.367 12.768 3.193 42.305 7.716 62.268-20.224l-.795 3.188c5.325 4.26 4.965 30.619 5.72 49.452.756 18.834 2.017 36.409 5.856 46.771 3.839 10.36 8.369 37.05 44.036 29.406 29.809-6.388 52.6-15.582 54.677-101.107"
        fill="#000"
        stroke="#000"
        strokeWidth="37.3953"
        strokeLinecap="butt"
        strokeLinejoin="miter"
      />
      <path
        stroke="none"
        d="M402.395 271.23c-50.302 10.376-53.76-6.655-53.76-6.655 53.111-78.808 75.313-178.843 56.153-203.326-52.27-66.785-142.752-35.2-144.262-34.38l-.486.087c-9.938-2.063-21.06-3.292-33.56-3.496-22.761-.373-40.026 5.967-53.127 15.902 0 0-161.411-66.495-153.904 83.63 1.597 31.938 45.776 241.657 98.471 178.312 19.26-23.163 37.869-42.748 37.869-42.748 9.243 6.14 20.308 9.272 31.908 8.147l.901-.765c-.28 2.876-.152 5.689.361 9.019-13.575 15.167-9.586 17.83-36.723 23.416-27.459 5.659-11.328 15.734-.796 18.367 12.768 3.193 42.307 7.716 62.266-20.224l-.796 3.188c5.319 4.26 9.054 27.711 8.428 48.969-.626 21.259-1.044 35.854 3.147 47.254 4.191 11.4 8.368 37.05 44.042 29.406 29.809-6.388 45.256-22.942 47.405-50.555 1.525-19.631 4.976-16.729 5.194-34.28l2.768-8.309c3.192-26.611.507-35.196 18.872-31.203l4.463.392c13.517.615 31.208-2.174 41.591-7 22.358-10.376 35.618-27.7 13.573-23.148z"
        className="fill-#336791 stroke-none"
      />
      <path d="M215.866 286.484c-1.385 49.516.348 99.377 5.193 111.495 4.848 12.118 15.223 35.688 50.9 28.045 29.806-6.39 40.651-18.756 45.357-46.051 3.466-20.082 10.148-75.854 11.005-87.281M173.104 38.256S11.583-27.76 19.092 122.365c1.597 31.938 45.779 241.664 98.473 178.316 19.256-23.166 36.671-41.335 36.671-41.335M260.349 26.207c-5.591 1.753 89.848-34.889 144.087 34.417 19.159 24.484-3.043 124.519-56.153 203.329" />
      <path
        d="M348.282 263.953s3.461 17.036 53.764 6.653c22.04-4.552 8.776 12.774-13.577 23.155-18.345 8.514-59.474 10.696-60.146-1.069-1.729-30.355 21.647-21.133 19.96-28.739-1.525-6.85-11.979-13.573-18.894-30.338-6.037-14.633-82.796-126.849 21.287-110.183 3.813-.789-27.146-99.002-124.553-100.599-97.385-1.597-94.19 119.762-94.19 119.762"
        strokeLinejoin="bevel"
      />
      <path d="M188.604 274.334c-13.577 15.166-9.584 17.829-36.723 23.417-27.459 5.66-11.326 15.733-.797 18.365 12.768 3.195 42.307 7.718 62.266-20.229 6.078-8.509-.036-22.086-8.385-25.547-4.034-1.671-9.428-3.765-16.361 3.994z" />
      <path d="M187.715 274.069c-1.368-8.917 2.93-19.528 7.536-31.942 6.922-18.626 22.893-37.255 10.117-96.339-9.523-44.029-73.396-9.163-73.436-3.193-.039 5.968 2.889 30.26-1.067 58.548-5.162 36.913 23.488 68.132 56.479 64.938" />
      <path
        d="M172.517 141.7c-.288 2.039 3.733 7.48 8.976 8.207 5.234.73 9.714-3.522 9.998-5.559.284-2.039-3.732-4.285-8.977-5.015-5.237-.731-9.719.333-9.996 2.367z"
        fill="#fff"
        strokeWidth="4.155"
        strokeLinecap="butt"
        strokeLinejoin="miter"
      />
      <path
        d="M331.941 137.543c.284 2.039-3.732 7.48-8.976 8.207-5.238.73-9.718-3.522-10.005-5.559-.277-2.039 3.74-4.285 8.979-5.015 5.239-.73 9.718.333 10.002 2.368z"
        fill="#fff"
        strokeWidth="2.0775"
        strokeLinecap="butt"
        strokeLinejoin="miter"
      />
      <path d="M350.676 123.432c.863 15.994-3.445 26.888-3.988 43.914-.804 24.748 11.799 53.074-7.191 81.435" />
    </g>
  </svg>
);
