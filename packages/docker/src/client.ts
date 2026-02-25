import Docker from "dockerode";

let instance: Docker | null = null;

export function getDockerClient(): Docker {
  instance ??= new Docker({ socketPath: "/var/run/docker.sock" });

  return instance;
}

export function setDockerClient(client: Docker): void {
  instance = client;
}

export function resetDockerClient(): void {
  instance = null;
}
