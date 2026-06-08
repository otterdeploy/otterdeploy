/**
 * Shared prop types for the resource-detail panels. Lives outside any
 * individual panel file so the layout shell + every panel can import
 * the same shape without going through `../layout.tsx` (which would
 * trip a circular import).
 */

export interface ResourceBodyProps {
  resource: {
    resourceId: string;
    projectId: string;
    name: string;
    engine: string;
    status: string;
    databaseName: string;
    username: string;
    password: string;
    publicEnabled: boolean;
    publicHostname: string;
    publicPort: number;
    publicConnectionString: string;
    internalHostname: string;
    internalPort: number;
    internalConnectionString: string;
    localConnectionString: string | null;
    runtime: {
      serviceId: string | null;
      serviceName: string;
      volumeName: string;
      networkName: string;
      status: string;
      health: string | null;
    };
    extraEnv: Record<string, string>;
    secretKeys: string[];
    extensions: string[];
  };
}
