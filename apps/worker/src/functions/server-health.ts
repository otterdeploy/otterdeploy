import { execSync } from "node:child_process";
import { createLogger } from "@otterdeploy/logger";
import { isSwarmActive } from "@otterdeploy/docker";
import { isCaddyRunning, bootstrapCaddy } from "@otterdeploy/proxy";
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
        execSync("docker info", { timeout: 5000, encoding: "utf-8" });
        checks.docker = { status: "ok" };
      } catch (error) {
        checks.docker = { status: "down", detail: "Docker daemon unreachable" };
        logger.error("Docker daemon health check failed");
      }

      // Check Swarm status
      try {
        const active = await isSwarmActive();
        checks.swarm = { status: active ? "ok" : "down" };
      } catch (swarmErr) {
        checks.swarm = { status: "down", detail: String(swarmErr) };
        logger.error({ err: swarmErr }, "Swarm health check failed");
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
            const running = await isCaddyRunning();
            if (!running) {
              const result = await bootstrapCaddy();
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
