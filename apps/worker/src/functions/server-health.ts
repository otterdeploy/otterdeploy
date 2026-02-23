import { createLogger } from "@otterdeploy/logger";
import { inngest } from "../inngest";

const logger = createLogger("server-health");

export const serverHealthMonitor = inngest.createFunction(
  {
    id: "server-health-monitor",
    retries: 1,
  },
  { cron: "* * * * *" }, // Every minute
  async ({ step }) => {
    await step.run("check-server-health", async () => {
      const checks: Record<string, { status: string; detail?: string }> = {};

      // Check Docker daemon
      try {
        const { execSync } = await import("node:child_process");
        execSync("docker info", { timeout: 5000, encoding: "utf-8" });
        checks.docker = { status: "ok" };
      } catch (error) {
        checks.docker = { status: "down", detail: "Docker daemon unreachable" };
        logger.error("Docker daemon health check failed");
      }

      // Check Swarm status
      try {
        const docker = await import("@otterdeploy/docker");
        const active = await docker.isSwarmActive();
        checks.swarm = { status: active ? "ok" : "down" };
      } catch {
        checks.swarm = { status: "down" };
      }

      // Check Caddy
      try {
        const response = await fetch("http://127.0.0.1:2019/config/", {
          signal: AbortSignal.timeout(3000),
        });
        checks.caddy = { status: response.ok ? "ok" : "down" };

        if (!response.ok) {
          // Attempt auto-restart
          logger.warn("Caddy health check failed, attempting auto-restart");
          try {
            const proxy = await import("@otterdeploy/proxy");
            const running = await proxy.isCaddyRunning();
            if (!running) {
              const result = await proxy.bootstrapCaddy();
              if (result.isOk()) {
                logger.info("Caddy auto-restarted successfully");
                checks.caddy = { status: "ok", detail: "auto-restarted" };
              }
            }
          } catch (restartErr) {
            logger.error({ err: restartErr }, "Caddy auto-restart failed");
          }
        }
      } catch {
        checks.caddy = { status: "down", detail: "Admin API unreachable" };
      }

      // Check disk usage
      try {
        const { execSync } = await import("node:child_process");
        const dfOutput = execSync("df -h /var/lib/docker 2>/dev/null || df -h /", {
          encoding: "utf-8",
          timeout: 5000,
        });
        const lines = dfOutput.trim().split("\n");
        if (lines.length >= 2) {
          const parts = lines[1].split(/\s+/);
          const usePercent = parseInt(parts[4], 10);
          checks.disk = {
            status: usePercent > 90 ? "critical" : usePercent > 75 ? "warning" : "ok",
            detail: `${usePercent}% used`,
          };
        }
      } catch {
        checks.disk = { status: "unknown" };
      }

      logger.info({ checks }, "Server health check completed");
      return checks;
    });
  },
);
