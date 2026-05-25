import {
  ActivityIcon,
  ContainerIcon,
  CogIcon,
  GaugeIcon,
  LayoutGridIcon,
  NetworkIcon,
  ServerIcon,
  ScrollTextIcon,
  UsersIcon,
  WorkflowIcon,
  type LucideIcon,
  // project rail icons:
  BoxIcon,
  KeyRoundIcon,
  RotateCcwIcon,
  SettingsIcon,
  Share2Icon,
} from "lucide-react";

export interface RailItem {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
}

export const outerRailItems: ReadonlyArray<RailItem> = [
  { id: "projects", label: "Projects", href: "/", icon: LayoutGridIcon },
  { id: "monitoring", label: "Monitoring", href: "/monitoring", icon: GaugeIcon },
  { id: "requests", label: "Requests", href: "/requests", icon: ScrollTextIcon },
  { id: "docker", label: "Docker", href: "/docker", icon: ContainerIcon },
  { id: "swarm", label: "Swarm", href: "/swarm", icon: WorkflowIcon },
  { id: "servers", label: "Servers", href: "/servers", icon: ServerIcon },
  { id: "routing", label: "Routing", href: "/routing", icon: NetworkIcon },
  { id: "activity", label: "Activity", href: "/activity", icon: ActivityIcon },
  { id: "members", label: "Members", href: "/members", icon: UsersIcon },
  { id: "settings", label: "Settings", href: "/settings", icon: CogIcon },
];

export const innerRailItems: ReadonlyArray<RailItem> = [
  { id: "canvas", label: "Canvas", href: "", icon: BoxIcon },
  { id: "logs", label: "Logs", href: "logs", icon: ScrollTextIcon },
  { id: "networking", label: "Networking", href: "networking", icon: Share2Icon },
  { id: "variables", label: "Variables", href: "variables", icon: KeyRoundIcon },
  { id: "deployments", label: "Deployments", href: "deployments", icon: RotateCcwIcon },
  { id: "settings", label: "Settings", href: "settings", icon: SettingsIcon },
];
