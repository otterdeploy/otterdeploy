export interface ServerRow {
  id: string;
  name: string;
  role: "manager" | "worker";
  cpuPercent: number;
  memoryPercent: number;
  diskPercent: number;
  uptime: string;
  status: "ready" | "draining" | "down";
}
