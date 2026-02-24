/**
 * GET /api/health
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A HEALTH CHECK ENDPOINT?
 * ─────────────────────────────────────────────────────────────────────────────
 * Every orchestration system (Docker, Kubernetes, AWS ECS, load balancers)
 * needs to know: "is this instance actually working?"
 *
 * Without a health endpoint:
 *   - Docker marks a container "healthy" the moment it starts — even if the
 *     app crashed 1 second later
 *   - Load balancers send traffic to broken instances
 *   - Kubernetes can't distinguish "running but broken" from "running fine"
 *
 * With a health endpoint:
 *   - Docker HEALTHCHECK calls it every 30s
 *   - Kubernetes liveness probe calls it every 10s
 *   - Load balancer health check calls it every 5s
 *   - Any non-200 response → remove from rotation, restart, alert
 *
 * TWO LEVELS OF HEALTH:
 *   Liveness:  "Is the process alive?" — basic ping/pong
 *   Readiness: "Is the process ready to serve traffic?" — checks dependencies
 *
 * This endpoint implements both. Docker uses it for liveness.
 * Kubernetes uses /api/health for liveness and /api/health?ready=true for readiness.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { NextApiRequest, NextApiResponse } from "next";

interface HealthResponse {
  status: "ok" | "degraded" | "error";
  timestamp: string;
  uptime: number;           // seconds since process started
  version: string;
  checks: {
    rpc: "ok" | "error" | "skipped";
    memory: "ok" | "warning" | "error";
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<HealthResponse>
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end();
  }

  const checks = {
    rpc: "skipped" as "ok" | "error" | "skipped",
    memory: "ok" as "ok" | "warning" | "error",
  };

  // ── Memory check ────────────────────────────────────────────────────────────
  // process.memoryUsage() returns bytes. Convert to MB for readability.
  // heapUsed > 90% of heapTotal = warning (GC pressure)
  // heapUsed > 95% of heapTotal = error (about to OOM crash)
  const mem = process.memoryUsage();
  const heapPercent = mem.heapUsed / mem.heapTotal;
  if (heapPercent > 0.95) checks.memory = "error";
  else if (heapPercent > 0.90) checks.memory = "warning";

  // ── RPC check (only when ?ready=true — readiness probe) ────────────────────
  // We don't check RPC on every liveness ping — that would hammer the node.
  // Only check when Kubernetes asks "are you ready to serve traffic?"
  const isReadinessCheck = req.query.ready === "true";
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL;

  if (isReadinessCheck && rpcUrl) {
    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_blockNumber",
          params: [],
          id: 1,
        }),
        signal: AbortSignal.timeout(3000), // 3s timeout — don't hang health checks
      });
      checks.rpc = response.ok ? "ok" : "error";
    } catch {
      checks.rpc = "error";
    }
  }

  // ── Determine overall status ────────────────────────────────────────────────
  const hasError = Object.values(checks).includes("error");
  const hasWarning = Object.values(checks).includes("warning");
  const status = hasError ? "error" : hasWarning ? "degraded" : "ok";

  // Return 503 if error — this tells load balancers to stop routing here
  const httpStatus = status === "error" ? 503 : 200;

  // Cache-Control: no-store — health checks must never be cached
  // A cached "ok" response defeats the entire purpose
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  return res.status(httpStatus).json({
    status,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    version: process.env.npm_package_version || "0.0.1",
    checks,
  });
}
