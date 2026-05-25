export type SessionSource =
  | {
      kind: "container";
      project: string;
      service: string;
      replica: string;
      containerId: string;
    }
  | {
      kind: "ssh";
      /** "local" attaches to the otterstack-server host shell — no SSH hop,
       *  legitimately implemented. "remote" is a real SSH into a swarm node
       *  (not wired up yet). */
      mode: "local" | "remote";
      node: string;
      host: string;
    }
  | { kind: "database"; engine: string; service: string; project: string };

export type Session = {
  id: string;
  label: string;
  source: SessionSource;
};

export function describeSource(source: SessionSource): string {
  switch (source.kind) {
    case "container":
      return `${source.service} · ${source.replica}`;
    case "ssh":
      return `ssh · ${source.node}`;
    case "database":
      return `db · ${source.service}`;
  }
}
