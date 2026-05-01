import http from "http";
import fs from "fs/promises";
import { getProcessManager } from "../process-manager/manager.js";
import { getSecretManager } from "../secret/manager.js";
import { getWorkflowManager } from "../workflow/manager.js";
import { getRegistryClient } from "../registry/client.js";
import { getToolRegistry } from "../tool-registry/registry.js";
import { getIntentService } from "../ai/intent-service.js";
import { getAIConfig, getConfigManager } from "../utils/config.js";
import {
  ensureInTorchDir,
  getDaemonPidPath,
  getDaemonLogPath,
  getLogPath,
} from "../utils/paths.js";
import { DaemonConfig } from "./types.js";
import { MCPClient } from "../mcp/client.js";
import {
  getExecuteService,
  type UnifiedExecutionOptions,
} from "../ai/execute-service.js";
import { healthCheckScheduler } from "../kernel/health-check-scheduler.js";

export class DaemonServer {
  private server: http.Server;
  private config: DaemonConfig;
  private startTime: number;
  private requestCount: number;

  constructor(
    config: Partial<DaemonConfig> = {
      /* Intentionally empty */
    },
  ) {
    this.config = {
      port: config.port || 9658,
      host: config.host || "localhost",
      pidFile: config.pidFile || getDaemonPidPath(),
      logFile: config.logFile || getDaemonLogPath(),
    };
    this.startTime = Date.now();
    this.requestCount = 0;
    this.server = this.createServer();
  }

  private createServer() {
    return http.createServer(async (req, res) => {
      try {
        await this.handleRequest(req, res);
      } catch (e) {
        console.error("[Daemon Error]", e);
        this.sendJson(res, 500, {
          error: "Internal Error",
          message: (e as Error).message,
        });
      }
    });
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ) {
    const method = req.method || "GET";
    const parsedUrl = new URL(req.url || "/", "http://localhost");
    const path = parsedUrl.pathname;

    // Increment request count for all requests except OPTIONS
    if (method !== "OPTIONS") {
      this.requestCount++;
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization",
    );
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, DELETE, OPTIONS",
    );

    if (method === "OPTIONS") return res.writeHead(200).end();

    console.log(`[Daemon] ${method} ${path}`);

    if (!(path === "/api/status" || path === "/api/auth/token" || path === "/api/sui/parse-intent" || path === "/api/sui/build-transaction")) {
      const auth = req.headers.authorization;
      const token = await getSecretManager().get("daemon_auth_token");
      if (!auth || auth.substring(7) !== token)
        return this.sendJson(res, 401, { error: "Unauthorized" });
    }

    let body = "";
    if (method === "POST" || method === "PUT") {
      body = await new Promise((resolve, reject) => {
        let b = "";
        req.on("data", (c) => (b += c));
        req.on("end", () => resolve(b));
        req.on("error", reject);
      });
    }

    // --- Routes ---
    if (path === "/api/status" && method === "GET") {
      const status = {
        running: true,
        pid: process.pid,
        config: this.config,
        uptime: Date.now() - this.startTime,
        version: "0.8.0", // Hardcoded version to avoid path resolution issues
        stats: {
          activeConnections: 0, // TODO: Implement connection tracking
          totalRequests: this.requestCount,
        },
      };
      return this.sendJson(res, 200, status);
    }

    // Handle /api/system/stats - return system statistics
    if (
      (path === "/api/system/stats" || path === "/api/system/stats/") &&
      method === "GET"
    ) {
      try {
        const processManager = getProcessManager();
        const allProcesses = await processManager.list();
        const runningProcesses = allProcesses.filter(
          (p) => p.status === "running",
        );

        // Get all servers from registry (cached manifests)
        const registryClient = getRegistryClient();
        const cachedManifests = await registryClient.listCachedManifests();

        const stats = {
          totalServers: cachedManifests.length,
          runningServers: runningProcesses.length,
          totalProcesses: allProcesses.length,
          diskUsage: 0, // TODO: Implement disk usage calculation
          uptime: Date.now() - this.startTime,
          requestCount: this.requestCount,
        };

        return this.sendJson(res, 200, { stats });
      } catch (error: any) {
        console.error("[Daemon] Error getting system stats:", error);
        return this.sendJson(res, 500, {
          error: "Failed to get system statistics",
          message: error.message,
        });
      }
    }

    // Handle /api/system/logs - return daemon logs
    if (
      (path === "/api/system/logs" || path === "/api/system/logs/") &&
      method === "GET"
    ) {
      try {
        const fs = await import("fs/promises");
        const logContent = await fs.readFile(this.config.logFile, "utf-8");
        return this.sendJson(res, 200, {
          logs: logContent,
          logFile: this.config.logFile,
          lastUpdated: new Date().toISOString(),
        });
      } catch (error: any) {
        if (error.code === "ENOENT") {
          return this.sendJson(res, 404, {
            error: "Logs Not Found",
            message: `Log file not found: ${this.config.logFile}`,
          });
        }
        return this.sendJson(res, 500, {
          error: "Internal Server Error",
          message: `Failed to read logs: ${error.message}`,
        });
      }
    }
    if (path === "/api/auth/token" && method === "GET")
      return this.sendJson(res, 200, {
        token: await getSecretManager().get("daemon_auth_token"),
      });

    if (path === "/api/servers" && method === "GET")
      return this.sendJson(res, 200, {
        servers: await getProcessManager().list(),
      });
    if (path === "/api/servers" && method === "POST") {
      try {
        const { serverNameOrUrl } = JSON.parse(body);

        if (!serverNameOrUrl || typeof serverNameOrUrl !== "string") {
          return this.sendJson(res, 400, {
            error: "Bad Request",
            message: "serverNameOrUrl is required and must be a string",
          });
        }

        // First fetch and cache the manifest
        const manifest =
          await getRegistryClient().fetchManifest(serverNameOrUrl);

        // Register tools
        await getToolRegistry().registerToolsFromManifest(
          serverNameOrUrl,
          manifest,
        );

        // Check if the server is already running before starting
        const existingProcesses = await getProcessManager().list();
        const runningServer = existingProcesses.find(
          (p) =>
            p.manifest &&
            p.manifest.name === manifest.name &&
            p.status === "running",
        );

        if (runningServer) {
          return this.sendJson(res, 200, {
            pid: runningServer.pid,
            name: runningServer.name || runningServer.manifest.name,
            version: runningServer.version || runningServer.manifest.version,
            status: runningServer.status,
            logPath: runningServer.logPath || getLogPath(runningServer.pid),
            alreadyRunning: true,
          });
        }
        // Then start the server
        const pid = await getProcessManager().start(serverNameOrUrl);
        const processInfo = await getProcessManager().get(pid);

        if (!processInfo) {
          return this.sendJson(res, 500, {
            error: "Server Startup Failed",
            message: `Failed to retrieve process info for PID ${pid}`,
            suggestion: "Check if the process started successfully",
          });
        }

        return this.sendJson(res, 201, {
          pid: processInfo.pid,
          name: processInfo.name || processInfo.manifest.name,
          version: processInfo.version || processInfo.manifest.version,
          status: processInfo.status,
          logPath: processInfo.logPath || getLogPath(processInfo.pid),
          alreadyRunning: false,
        });
      } catch (error: any) {
        // Handle JSON parsing errors
        if (error instanceof SyntaxError) {
          return this.sendJson(res, 400, {
            error: "Invalid JSON",
            message: "Request body must be valid JSON",
          });
        }

        // If starting fails, still return the cached manifest info
        try {
          const { serverNameOrUrl } = JSON.parse(body);
          const manifest =
            await getRegistryClient().getCachedManifest(serverNameOrUrl);
          if (manifest) {
            return this.sendJson(res, 500, {
              error: "Server Startup Failed",
              message: `Failed to start server: ${error.message}`,
              details: {
                manifestName: manifest.name,
                manifestVersion: manifest.version,
                manifestDescription: manifest.description,
                suggestion: "Check server configuration and required secrets",
              },
            });
          }
        } catch (cacheError) {
          // Ignore cache error
        }

        return this.sendJson(res, 500, {
          error: "Server Startup Failed",
          message: `Failed to start server: ${error.message}`,
          suggestion:
            "Check if the server name/URL is valid and all required secrets are set",
        });
      }
    }

    if (path === "/api/servers/import" && method === "POST") {
      try {
        const { config } = JSON.parse(body);
        if (!config || typeof config !== "string") {
          return this.sendJson(res, 400, {
            error: "Bad Request",
            message: "config is required and must be a JSON string",
          });
        }

        const manifests = await getRegistryClient().importConfig(config);

        return this.sendJson(res, 200, {
          success: true,
          message: `Successfully imported ${manifests.length} MCP server(s)`,
          imported: manifests.map((m) => ({
            name: m.name,
            version: m.version,
            description: m.description,
          })),
          total: manifests.length,
        });
      } catch (error: any) {
        if (error instanceof SyntaxError) {
          return this.sendJson(res, 400, {
            error: "Invalid JSON",
            message: "Request body must be valid JSON",
          });
        } else {
          return this.sendJson(res, 400, {
            success: false,
            error: "Import Failed",
            message: error.message,
            suggestion:
              'Please check that the config is valid Claude Desktop format (has "mcpServers" field)',
          });
        }
      }
    }

    if (path === "/api/servers/pull" && method === "POST") {
      try {
        const { serverNameOrUrl } = JSON.parse(body);

        if (!serverNameOrUrl || typeof serverNameOrUrl !== "string") {
          return this.sendJson(res, 400, {
            error: "Bad Request",
            message: "serverNameOrUrl is required and must be a string",
          });
        }

        // Just fetch and cache the manifest without starting the server
        const manifest =
          await getRegistryClient().fetchManifest(serverNameOrUrl);
        console.log(
          "[Daemon] Pulled manifest:",
          JSON.stringify(manifest, null, 2).substring(0, 500),
        );

        // Register tools
        await getToolRegistry().registerToolsFromManifest(
          serverNameOrUrl,
          manifest,
        );

        return this.sendJson(res, 200, {
          success: true,
          message: `Successfully pulled and cached manifest for ${manifest.name}`,
          manifest: {
            name: manifest.name,
            version: manifest.version,
            description: manifest.description,
          },
        });
      } catch (error: any) {
        // Handle JSON parsing errors
        if (error instanceof SyntaxError) {
          return this.sendJson(res, 400, {
            error: "Invalid JSON",
            message: "Request body must be valid JSON",
          });
        }

        return this.sendJson(res, 400, {
          success: false,
          error: "Manifest Pull Failed",
          message: `Failed to pull manifest: ${error.message}`,
          suggestion: "Check if the server name/URL is valid and accessible",
        });
      }
    }
    if (path === "/api/servers/search" && method === "GET") {
      const query = parsedUrl.searchParams.get("q") || "";
      const source = parsedUrl.searchParams.get("source") || "all";
      return this.sendJson(
        res,
        200,
        await getRegistryClient().searchServices({ query, source }),
      );
    }

    if (path === "/api/servers/cached" && method === "GET") {
      const cachedManifests = await getRegistryClient().listCachedManifests();
      // Convert manifest names to service info format
      const services = cachedManifests.map((name) => ({
        name,
        description: `Cached MCP Server: ${name}`,
        version: "unknown",
        source: "local",
        tags: ["cached", "local"],
        lastUpdated: new Date().toISOString().split("T")[0], // Today's date in YYYY-MM-DD format
      }));
      return this.sendJson(res, 200, {
        services,
        total: services.length,
        source: "local",
        hasMore: false,
      });
    }

    // Server detail and management endpoints
    if (path.startsWith("/api/servers/") && method === "GET") {
      const match = path.match(/^\/api\/servers\/(\d+)$/);
      if (match) {
        const pid = parseInt(match[1], 10);
        const processInfo = await getProcessManager().get(pid);
        if (!processInfo) {
          return this.sendJson(res, 404, {
            error: "Not Found",
            message: `Server with PID ${pid} not found`,
          });
        }
        return this.sendJson(res, 200, processInfo);
      }

      // Check for logs endpoint
      const logsMatch = path.match(/^\/api\/servers\/(\d+)\/logs$/);
      if (logsMatch) {
        const pid = parseInt(logsMatch[1], 10);
        const processInfo = await getProcessManager().get(pid);
        if (!processInfo) {
          return this.sendJson(res, 404, {
            error: "Not Found",
            message: `Server with PID ${pid} not found`,
          });
        }

        try {
          const fs = await import("fs/promises");
          const { getLogPath } = await import("../utils/paths.js");
          const logPath = getLogPath(pid);
          const logContent = await fs.readFile(logPath, "utf-8");
          return this.sendJson(res, 200, {
            pid,
            logs: logContent,
            logPath,
          });
        } catch (error: any) {
          if (error.code === "ENOENT") {
            return this.sendJson(res, 404, {
              error: "Logs Not Found",
              message: `Log file for PID ${pid} not found`,
            });
          }
          return this.sendJson(res, 500, {
            error: "Internal Server Error",
            message: `Failed to read logs: ${error.message}`,
          });
        }
      }
    }

    if (path.startsWith("/api/servers/") && method === "DELETE") {
      const match = path.match(/^\/api\/servers\/(\d+)$/);
      if (match) {
        const pid = parseInt(match[1], 10);
        const processInfo = await getProcessManager().get(pid);
        if (!processInfo) {
          return this.sendJson(res, 404, {
            error: "Not Found",
            message: `Server with PID ${pid} not found`,
          });
        }

        // Check if process is already stopped
        if (processInfo.status === "stopped") {
          return this.sendJson(res, 200, {
            success: true,
            message: `Server with PID ${pid} is already stopped`,
            pid,
          });
        }

        try {
          await getProcessManager().stop(pid);
          return this.sendJson(res, 200, {
            success: true,
            message: `Server with PID ${pid} stopped successfully`,
            pid,
          });
        } catch (error: any) {
          return this.sendJson(res, 500, {
            error: "Failed to Stop Server",
            message: `Failed to stop server: ${error.message}`,
          });
        }
      }
    }

    if (
      (path === "/api/workflows" || path === "/api/workflows/") &&
      method === "GET"
    )
      return this.sendJson(res, 200, {
        workflows: await getWorkflowManager().list(),
      });
    if (
      (path === "/api/workflows" || path === "/api/workflows/") &&
      method === "POST"
    ) {
      const data = JSON.parse(body);
      const id = await getWorkflowManager().save(data);
      // Ensure the workflow object has the correct ID
      const workflowWithId = { ...data, id };
      return this.sendJson(res, 201, { workflow: workflowWithId });
    }

    // GET /api/workflows/{id}
    const workflowIdMatch = path.match(/^\/api\/workflows\/([^\/]+)$/);
    if (workflowIdMatch) {
      const id = decodeURIComponent(workflowIdMatch[1]);

      if (method === "GET") {
        try {
          const workflow = await getWorkflowManager().load(id);
          if (!workflow) {
            return this.sendJson(res, 404, {
              error: "Not Found",
              message: `Workflow with ID ${id} not found`,
            });
          }
          return this.sendJson(res, 200, { workflow });
        } catch (error: any) {
          return this.sendJson(res, 500, {
            error: "Internal Server Error",
            message: `Failed to load workflow: ${error.message}`,
          });
        }
      }

      if (method === "DELETE") {
        try {
          await getWorkflowManager().delete(id);
          return this.sendJson(res, 200, {
            success: true,
            message: `Workflow ${id} deleted successfully`,
          });
        } catch (error: any) {
          return this.sendJson(res, 500, {
            error: "Internal Server Error",
            message: `Failed to delete workflow: ${error.message}`,
          });
        }
      }
    }
    // Handle workflow execution endpoints
    if (
      path.startsWith("/api/workflows/") &&
      path.endsWith("/execute") &&
      method === "POST"
    ) {
      const id = path.replace("/api/workflows/", "").replace("/execute", "");
      const wf = await getWorkflowManager().load(id);
      if (!wf) return this.sendJson(res, 404, { error: "Not Found" });
      const results = [];

      // Get all running servers
      const runningServers = await getProcessManager().list();

      for (const s of wf.steps || []) {
        const sid = s.serverId || s.serverName;
        if (!sid) continue;
        try {
          // First, try to find the manifest from running servers
          let manifest = null;

          // Look for a running server that matches the serverId
          for (const server of runningServers) {
            if (server.manifest && server.manifest.name === sid) {
              manifest = server.manifest;
              break;
            }
          }

          // If not found in running servers, try to fetch from registry
          if (!manifest) {
            manifest = await getRegistryClient().fetchManifest(sid);
          }

          const client = new MCPClient({
            transport: {
              type: "stdio",
              command: manifest.runtime.command,
              args: manifest.runtime.args || [],
              env: { ...process.env } as Record<string, string>,
            },
          });

          // Handle transport errors to prevent process crash
          client.on("error", (error) => {
            console.warn(
              `[Daemon] MCP Client error for ${sid}: ${error.message || error}`,
            );
          });

          await client.connect();
          const out = await client.callTool(
            s.toolName,
            s.parameters ||
              {
                /* Intentionally empty */
              },
          );
          results.push({
            toolName: s.toolName,
            status: "success",
            output: out,
          });
          await client.disconnect();
        } catch (e) {
          results.push({
            toolName: s.toolName,
            status: "error",
            error: (e as Error).message,
          });
        }
      }

      // Update workflow's lastExecutedAt timestamp
      try {
        const updatedWorkflow = {
          ...wf,
          lastExecutedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await getWorkflowManager().save(updatedWorkflow);
      } catch (updateError) {
        console.error(
          "[Daemon] Failed to update workflow lastExecutedAt:",
          updateError,
        );
        // Continue execution even if update fails
      }

      return this.sendJson(res, 200, {
        success: true,
        results,
        totalSteps: results.length,
      });
    }

    // Execution endpoints (using CLI run command capabilities)
    if (
      (path === "/api/execute/natural-language" ||
        path === "/api/execute/naturalLanguage") &&
      method === "POST"
    ) {
      try {
        const { query, options } = JSON.parse(body);

        if (!query || typeof query !== "string") {
          return this.sendJson(res, 400, {
            success: false,
            error: "Query is required and must be a string",
          });
        }

        console.log(
          `[Daemon] Executing natural language query: "${query.substring(0, 100)}..."`,
        );

        // Get execution service
        const executionService = getExecuteService();

        if (!executionService) {
          console.error("[Daemon] Execution service is not available");
          return this.sendJson(res, 503, {
            success: false,
            error:
              "Execution service is not available. Please check service configuration.",
          });
        }

        // Execute with options
        const executionOptions: UnifiedExecutionOptions = options || {};
        const result = await executionService.executeNaturalLanguage(
          query,
          executionOptions,
        );

        return this.sendJson(res, result.success ? 200 : 400, result);
      } catch (error: any) {
        console.error(
          "[Daemon] Error executing natural language query:",
          error,
        );
        console.error("[Daemon] Error stack:", error.stack);
        return this.sendJson(res, 500, {
          success: false,
          error: `Failed to execute query: ${error.message}`,
        });
      }
    }

    if (
      (path === "/api/execute/parse-intent" ||
        path === "/api/execute/parseIntent") &&
      method === "POST"
    ) {
      try {
        const { intent, context } = JSON.parse(body);

        if (!intent || typeof intent !== "string") {
          return this.sendJson(res, 400, {
            success: false,
            error: "Intent is required and must be a string",
          });
        }

        console.log(
          `[Daemon] Parsing intent: "${intent.substring(0, 100)}..."`,
        );

        // Get execution service
        const executionService = getExecuteService();

        if (!executionService) {
          console.error("[Daemon] Execution service is not available");
          return this.sendJson(res, 503, {
            success: false,
            error:
              "Execution service is not available. Please check service configuration.",
          });
        }

        console.log(
          "[Daemon] Execution service obtained, calling parseIntent...",
        );

        // Parse intent using execution service (same as CLI run command)
        const result = await executionService.parseIntent(intent, context);

        console.log("[Daemon] Execution service parseIntent result:", result);

        return this.sendJson(res, 200, {
          success: true,
          data: {
            steps: result.steps,
            status: result.status,
            confidence: result.confidence,
            explanation: result.explanation,
          },
        });
      } catch (error: any) {
        console.error("[Daemon] Error parsing intent:", error);
        console.error("[Daemon] Error stack:", error.stack);
        console.error(
          "[Daemon] Error details:",
          JSON.stringify(error, null, 2),
        );
        return this.sendJson(res, 500, {
          success: false,
          error: `Failed to parse intent: ${error.message}`,
        });
      }
    }

    // Execute pre-parsed steps (for Web UI - no re-parsing)
    if (
      (path === "/api/execute/steps" ||
        path === "/api/execute/execute-steps" ||
        path === "/api/execute/executeSteps") &&
      method === "POST"
    ) {
      try {
        const { steps, options } = JSON.parse(body);

        if (!steps || !Array.isArray(steps) || steps.length === 0) {
          return this.sendJson(res, 400, {
            success: false,
            error: "Steps are required and must be a non-empty array",
          });
        }

        console.log(`[Daemon] Executing ${steps.length} pre-parsed steps`);

        // Get execution service
        const executionService = getExecuteService();

        if (!executionService) {
          console.error("[Daemon] Execution service is not available");
          return this.sendJson(res, 503, {
            success: false,
            error:
              "Execution service is not available. Please check service configuration.",
          });
        }

        // Execute steps directly without re-parsing
        const executionOptions: UnifiedExecutionOptions = options || {};
        const result = await executionService.executeSteps(
          steps,
          executionOptions,
        );

        return this.sendJson(res, result.success ? 200 : 400, result);
      } catch (error: any) {
        console.error("[Daemon] Error executing pre-parsed steps:", error);
        console.error("[Daemon] Error stack:", error.stack);
        return this.sendJson(res, 500, {
          success: false,
          error: `Failed to execute steps: ${error.message}`,
        });
      }
    }

    // Interactive intent parsing endpoints
    if (path === "/api/execute/interactive/start" && method === "POST") {
      try {
        const { query, userId } = JSON.parse(body);

        if (!query || typeof query !== "string") {
          return this.sendJson(res, 400, {
            success: false,
            error: "Query is required and must be a string",
          });
        }

        console.log(
          `[Daemon] Starting interactive session for query: "${query.substring(0, 100)}..."`,
        );

        // Get execution service
        const executionService = getExecuteService();

        if (!executionService) {
          console.error("[Daemon] Execution service is not available");
          return this.sendJson(res, 503, {
            success: false,
            error:
              "Execution service is not available. Please check service configuration.",
          });
        }

        // Start interactive session
        const result = await executionService.startInteractiveSession(
          query,
          userId,
        );

        console.log(
          `[Daemon] Interactive session started: ${result.sessionId}`,
        );

        return this.sendJson(res, 200, {
          success: true,
          sessionId: result.sessionId,
          guidance: result.guidance,
          session: result.session,
        });
      } catch (error: any) {
        console.error("[Daemon] Error starting interactive session:", error);
        return this.sendJson(res, 500, {
          success: false,
          error: `Failed to start interactive session: ${error.message}`,
        });
      }
    }

    if (path === "/api/execute/interactive/respond" && method === "POST") {
      try {
        const { sessionId, response } = JSON.parse(body);

        if (!sessionId || typeof sessionId !== "string") {
          return this.sendJson(res, 400, {
            success: false,
            error: "Session ID is required and must be a string",
          });
        }

        if (!response || typeof response !== "object") {
          return this.sendJson(res, 400, {
            success: false,
            error: "Response is required and must be an object",
          });
        }

        console.log(`[Daemon] Processing feedback for session: ${sessionId}`);

        // Get execution service
        const executionService = getExecuteService();

        if (!executionService) {
          console.error("[Daemon] Execution service is not available");
          return this.sendJson(res, 503, {
            success: false,
            error:
              "Execution service is not available. Please check service configuration.",
          });
        }

        // Process user feedback
        const result = await executionService.processInteractiveFeedback(
          sessionId,
          response,
        );

        if (!result.success) {
          return this.sendJson(res, 404, {
            success: false,
            error: "Session not found or invalid",
          });
        }

        return this.sendJson(res, 200, {
          success: true,
          guidance: result.guidance,
          session: result.session,
          readyForExecution: result.readyForExecution,
        });
      } catch (error: any) {
        console.error("[Daemon] Error processing interactive feedback:", error);
        return this.sendJson(res, 500, {
          success: false,
          error: `Failed to process interactive feedback: ${error.message}`,
        });
      }
    }

    if (path === "/api/execute/interactive/execute" && method === "POST") {
      try {
        const { sessionId, options = {} } = JSON.parse(body);

        if (!sessionId || typeof sessionId !== "string") {
          return this.sendJson(res, 400, {
            success: false,
            error: "Session ID is required and must be a string",
          });
        }

        console.log(`[Daemon] Executing interactive session: ${sessionId}`);

        // Get execution service
        const executionService = getExecuteService();

        if (!executionService) {
          console.error("[Daemon] Execution service is not available");
          return this.sendJson(res, 503, {
            success: false,
            error:
              "Execution service is not available. Please check service configuration.",
          });
        }

        // Execute session
        const result = await executionService.executeInteractiveSession(
          sessionId,
          options,
        );

        return this.sendJson(res, result.success ? 200 : 500, {
          success: result.success,
          result: result.result,
          executionSteps: result.executionSteps,
          statistics: result.statistics,
          error: result.error,
        });
      } catch (error: any) {
        console.error("[Daemon] Error executing interactive session:", error);
        return this.sendJson(res, 500, {
          success: false,
          error: `Failed to execute interactive session: ${error.message}`,
        });
      }
    }

    if (path.startsWith("/api/execute/interactive/") && method === "GET") {
      try {
        const sessionId = path.substring("/api/execute/interactive/".length);

        if (!sessionId) {
          // Return all active sessions
          const executionService = getExecuteService();
          if (!executionService) {
            return this.sendJson(res, 503, {
              success: false,
              error: "Execution service is not available",
            });
          }

          const sessions = executionService.getActiveInteractiveSessions();
          return this.sendJson(res, 200, {
            success: true,
            sessions,
          });
        }

        console.log(`[Daemon] Getting interactive session: ${sessionId}`);

        // Get execution service
        const executionService = getExecuteService();

        if (!executionService) {
          console.error("[Daemon] Execution service is not available");
          return this.sendJson(res, 503, {
            success: false,
            error:
              "Execution service is not available. Please check service configuration.",
          });
        }

        // Get session
        const session = executionService.getInteractiveSession(sessionId);

        if (!session) {
          return this.sendJson(res, 404, {
            success: false,
            error: "Session not found",
          });
        }

        return this.sendJson(res, 200, {
          success: true,
          session,
        });
      } catch (error: any) {
        console.error("[Daemon] Error getting interactive session:", error);
        return this.sendJson(res, 500, {
          success: false,
          error: `Failed to get interactive session: ${error.message}`,
        });
      }
    }

    if (path === "/api/execute/interactive/cleanup" && method === "POST") {
      try {
        const { maxAgeMs = 3600000 } = JSON.parse(body);

        console.log(
          `[Daemon] Cleaning up old interactive sessions (max age: ${maxAgeMs}ms)`,
        );

        // Get execution service
        const executionService = getExecuteService();

        if (!executionService) {
          console.error("[Daemon] Execution service is not available");
          return this.sendJson(res, 503, {
            success: false,
            error:
              "Execution service is not available. Please check service configuration.",
          });
        }

        // Cleanup old sessions
        const cleanedCount =
          executionService.cleanupInteractiveSessions(maxAgeMs);

        return this.sendJson(res, 200, {
          success: true,
          cleanedCount,
          message: `Cleaned up ${cleanedCount} old sessions`,
        });
      } catch (error: any) {
        console.error(
          "[Daemon] Error cleaning up interactive sessions:",
          error,
        );
        return this.sendJson(res, 500, {
          success: false,
          error: `Failed to cleanup interactive sessions: ${error.message}`,
        });
      }
    }

    if (path === "/api/intent/parse" && method === "POST") {
      try {
        const { intent, context } = JSON.parse(body);

        if (!intent || typeof intent !== "string") {
          return this.sendJson(res, 400, {
            success: false,
            error: "Intent is required and must be a string",
          });
        }

        // Get AI configuration from system config
        const aiConfig = await getAIConfig();

        // Use universal intent service (LLM-driven, language-agnostic)
        const intentService = getIntentService(aiConfig);
        const result = await intentService.parseIntent({ intent, context });

        return this.sendJson(res, result.success ? 200 : 400, result);
      } catch (error: any) {
        console.error("[Daemon] Error parsing intent:", error);
        return this.sendJson(res, 500, {
          success: false,
          error: `Failed to parse intent: ${error.message}`,
        });
      }
    }

    // ===== Sui Intent Routes =====
    if (path === "/api/sui/parse-intent" && method === "POST") {
      try {
        const { intent, apiKey, provider, model } = JSON.parse(body);

        if (!intent) {
          return this.sendJson(res, 400, { success: false, error: 'Missing required field: intent' });
        }

        if (!apiKey) {
          return this.sendJson(res, 400, { success: false, error: 'Missing required field: apiKey' });
        }

        // 创建 CloudIntentEngine（用完即弃，不持久化 apiKey）
        const { CloudIntentEngine } = await import("../ai/cloud-intent-engine.js");
        const engine = new CloudIntentEngine({
          llm: {
            provider: provider || 'deepseek',
            apiKey,
            model: model || 'deepseek-chat',
            temperature: 0.3,
            maxTokens: 2000,
            timeout: 30000,
            maxRetries: 2,
          },
          execution: {
            maxConcurrentTools: 3,
            timeout: 60000,
            retryAttempts: 1,
            retryDelay: 1000,
          },
          fallback: {
            enableKeywordMatching: true,
            askUserOnFailure: false,
          },
        });

        // 注册 Sui MCP Tools
        const { getSuiMCPTools } = await import("../sui/sui-mcp-tools.js");
        const suiTools = getSuiMCPTools();
        engine.setAvailableTools(suiTools);

        console.log(`[SuiIntent] Parsing intent with ${suiTools.length} Sui MCP tools available`);
        console.log(`[SuiIntent] Using provider=${provider || 'deepseek'}, model=${model || 'deepseek-chat'}`);

        // 使用 CloudIntentEngine 解析意图
        // 使用 toolChoice: "none" 禁用 function calling，让 LLM 以纯文本 JSON 格式返回多步计划
        // 因为 DeepSeek 的 function calling 倾向于只选择查询类工具（cetus_get_pools）
        let plan = await engine.planQuery(intent, {
          toolChoice: "none",
          systemPrompt: `你是一个 Sui 区块链 DeFi 意图解析器。你的任务是将用户的自然语言描述转换为结构化的多步执行计划。

可用的 DeFi 工具（请严格按需选择）：
${suiTools.map(t => `- **${t.name}**: ${t.description?.split('\n')[0] || ''}`).join('\n')}

## 关键规则（必须遵守）：
1. **选择正确的工具**：用户说"卖出/兑换/swap" → 用 \`cetus_swap\`（不是 cetus_get_pools 或 cetus_get_quote）
2. **多步意图**：如果用户描述包含多个操作（如"卖出 A 然后存入 B"），必须生成多个步骤
3. **依赖关系**：如果步骤 B 需要步骤 A 的输出，设置 dependsOn: ["step_A_id"]
4. **参数提取**：从用户描述中提取代币类型、金额、地址等参数
5. **金额格式**：使用最小单位（如 0.1 SUI = 100000000）
6. **代币类型**：使用完整格式（如 "0x2::sui::SUI"）

## 常见场景示例：
- "在 Cetus 上卖出 0.1 SUI 买入 USDC，然后在 Navi 上存入 USDC"
  → 步骤1: cetus_swap (coinTypeIn="0x2::sui::SUI", coinTypeOut="0x...::usdc::USDC", amount="100000000")
  → 步骤2: navi_deposit (coinType="0x...::usdc::USDC", amount="auto", dependsOn=["step1"])

- "在 Cetus 上卖出 SUI 买入 USDC，然后将收益转入 0x123..."
  → 步骤1: cetus_swap (coinTypeIn="0x2::sui::SUI", coinTypeOut="0x...::usdc::USDC", amount="auto")
  → 步骤2: sui_transfer (recipient="0x123...", coinType="0x...::usdc::USDC", amount="all", dependsOn=["step1"])

- "在 Navi 上存入 10 SUI"
  → 步骤1: navi_deposit (coinType="0x2::sui::SUI", amount="10000000000")

## 输出格式（重要）：
你必须返回一个 **纯 JSON 对象**，不要使用 markdown 代码块包裹，不要添加任何解释性文字。
直接输出 JSON，格式如下：
{
  "summary": "计划摘要",
  "steps": [
    {
      "id": "step_1",
      "toolName": "工具名称",
      "description": "步骤描述",
      "arguments": { "参数名": "参数值" },
      "dependsOn": []
    }
  ]
}

## 重要：
- 不要调用任何 function/tool
- 不要使用 markdown 代码块包裹 JSON
- 不要添加任何解释性文字，只输出 JSON
- 如果用户描述包含多个操作，必须生成多个步骤
- 确保代币类型使用完整格式`,
        });

        // 重试机制：如果第一次解析没有生成步骤，重试一次
        if (plan.steps.length === 0) {
          console.log('[SuiIntent] First attempt generated 0 steps, retrying with stricter prompt...');
          plan = await engine.planQuery(intent, {
            toolChoice: "none",
            systemPrompt: `你是一个 Sui 区块链 DeFi 意图解析器。你必须生成一个多步执行计划。

可用的执行工具（必须从以下工具中选择）：
${suiTools.filter(t => !['cetus_get_pools', 'cetus_get_quote'].includes(t.name)).map(t => `- **${t.name}**: ${t.description?.split('\n')[0] || ''}`).join('\n')}

## 强制规则（必须严格遵守）：
1. 用户说"卖出/兑换/swap" → 必须用 \`cetus_swap\`
2. 用户说"存入/deposit" → 必须用 \`navi_deposit\`
3. 用户说"提取/withdraw" → 必须用 \`navi_withdraw\`
4. 用户说"转账/转入/发送" → 必须用 \`sui_transfer\`
5. 如果用户描述包含多个操作，必须生成多个步骤
6. 如果步骤 B 需要步骤 A 的输出，设置 dependsOn
7. 金额使用最小单位（如 0.1 SUI = 100000000）
8. 代币类型使用完整格式（如 "0x2::sui::SUI"）

## 输出格式：
只输出纯 JSON，不要使用 markdown 代码块，不要添加任何解释文字：
{
  "summary": "计划摘要",
  "steps": [
    { "id": "step_1", "toolName": "cetus_swap", "description": "...", "arguments": {...}, "dependsOn": [] },
    { "id": "step_2", "toolName": "navi_deposit", "description": "...", "arguments": {...}, "dependsOn": ["step_1"] }
  ]
}`,
            model: model || 'deepseek-chat',
            temperature: 0.1,
          });
          console.log(`[SuiIntent] Retry generated plan with ${plan.steps.length} steps`);
        }

        // 后处理：如果 LLM 只选择了查询类工具，手动修正为执行类工具
        if (plan.steps.length > 0) {
          const queryTools = ['cetus_get_pools', 'cetus_get_quote'];
          const hasQueryTool = plan.steps.some(s => queryTools.includes(s.toolName));
          const hasExecTool = plan.steps.some(s => ['cetus_swap', 'navi_deposit', 'navi_withdraw', 'navi_borrow', 'navi_repay', 'sui_transfer'].includes(s.toolName));

          if (hasQueryTool && !hasExecTool) {
            console.log('[SuiIntent] LLM selected query-only tools, applying post-processing to generate execution plan');

            // 重新生成正确的计划 - 使用 toolChoice: "none" 禁用 function calling
            const correctedPlan = await engine.planQuery(intent, {
              toolChoice: "none",
              systemPrompt: `你是一个 Sui 区块链 DeFi 意图解析器。你必须生成一个多步执行计划。

可用的执行工具（必须从以下工具中选择，不要使用查询类工具）：
${suiTools.filter(t => !queryTools.includes(t.name)).map(t => `- **${t.name}**: ${t.description?.split('\n')[0] || ''}`).join('\n')}

## 强制规则：
1. 用户说"卖出/兑换/swap" → 必须用 \`cetus_swap\`
2. 用户说"存入/deposit" → 必须用 \`navi_deposit\`
3. 用户说"提取/withdraw" → 必须用 \`navi_withdraw\`
4. 用户说"转账/转入/发送" → 必须用 \`sui_transfer\`
5. 如果用户描述包含多个操作，必须生成多个步骤
6. 如果步骤 B 需要步骤 A 的输出，设置 dependsOn
7. 金额使用最小单位（如 0.1 SUI = 100000000）
8. 代币类型使用完整格式（如 "0x2::sui::SUI"）

示例：
- "在 Cetus 上卖出 0.1 SUI 买入 USDC，然后在 Navi 上存入 USDC"
  → 步骤1: cetus_swap (coinTypeIn="0x2::sui::SUI", coinTypeOut="0x...::usdc::USDC", amount="100000000")
  → 步骤2: navi_deposit (coinType="0x...::usdc::USDC", amount="auto", dependsOn=["step1"])

## 输出格式：
只输出纯 JSON，不要使用 markdown 代码块，不要添加任何解释文字：
{
  "summary": "计划摘要",
  "steps": [
    { "id": "step_1", "toolName": "cetus_swap", "description": "...", "arguments": {...}, "dependsOn": [] },
    { "id": "step_2", "toolName": "navi_deposit", "description": "...", "arguments": {...}, "dependsOn": ["step_1"] }
  ]
}`,
              model: model || 'deepseek-chat',
              temperature: 0.1,
            });

            if (correctedPlan.steps.length > 0) {
              plan.steps = correctedPlan.steps;
              plan.summary = correctedPlan.summary;
              console.log(`[SuiIntent] Post-processing corrected plan: ${plan.steps.length} steps`);
            }
          }
        }

        console.log(`[SuiIntent] Plan generated: ${plan.steps.length} steps`);


        return this.sendJson(res, 200, {
          success: true,
          plan: {
            id: plan.id,
            summary: plan.summary,
            steps: plan.steps.map(step => ({
              id: step.id,
              toolName: step.toolName,
              serverName: step.serverName,
              description: step.description,
              arguments: step.arguments,
              dependsOn: step.dependsOn,
            })),
          },
        });
      } catch (error: any) {
        console.error('[SuiIntent] Parse error:', error);
        return this.sendJson(res, 500, {
          success: false,
          error: `Failed to parse intent: ${error.message}`,
        });
      }
    }

    if (path === "/api/sui/build-transaction" && method === "POST") {
      try {
        const { plan, signerAddress, network: reqNetwork } = JSON.parse(body);

        if (!plan || !plan.steps) {
          return this.sendJson(res, 400, { success: false, error: 'Missing required field: plan' });
        }

        // 自动检测网络：优先使用请求中的 network 参数，否则从 plan 中推断，默认 testnet
        const network = (reqNetwork || plan.network || 'testnet') as 'mainnet' | 'testnet';
        console.log(`[SuiIntent] Building transaction for network: ${network}`);

        // 使用 CrossProtocolOrchestrator 构建真实 PTB
        // 将 LLM 解析的步骤（toolName 格式）转换为 CrossProtocolPlan 格式
        const { CrossProtocolOrchestrator } = await import("../sui/cross-protocol-orchestrator.js");
        const { getCetusConfig, getNaviConfig, getRpcUrl } = await import("../sui/network-config.js");

        const cetusContracts = getCetusConfig(network);
        const naviContracts = await getNaviConfig(network);

        const orchestrator = new CrossProtocolOrchestrator({
          network,
          contractAddresses: {
            cetus_package: cetusContracts.cetus_package,
            cetus_global_config: cetusContracts.global_config_id,
            cetus_integrate: cetusContracts.integrate_published_at,
            cetus_pools_id: cetusContracts.pools_id,
            navi_package: naviContracts.package_id,
            navi_storage: naviContracts.usdc.poolId,
            sui_system: '0x3',
          },
        });
        await orchestrator.initialize();

        // 根据网络修正 LLM 返回的 coinType 地址
        // LLM 可能返回 mainnet 的地址，在 testnet 上需要替换为对应的 testnet 地址
        // testnet 地址从 Cetus testnet coin_list 动态获取
        const mainnetToTestnetCoinTypeMap: Record<string, string> = {
          '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN': '0x14a71d857b34677a7d57e0feb303df1adb515a37780645ab763d42ce8d1a5e48::usdc::USDC',
          '0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN': '0x14a71d857b34677a7d57e0feb303df1adb515a37780645ab763d42ce8d1a5e48::usdt::USDT',
          '0xaf8cd5edc19c4512f4259f0bee101a40d41ebed738ade5874359610ef8eeced5::coin::COIN': '0xbd22966ee345483662ec067201c5b648fefe97121382836bbcb836d25124ec6c::eth::ETH',
        };

        // 将 LLM 解析的步骤映射为 CrossProtocolPlan
        const crossProtocolPlan = {
          id: plan.id || `plan_${Date.now()}`,
          query: plan.summary || '',
          steps: plan.steps.map((s: any) => {
            const params = { ...(s.arguments || {}) };
            
            // 根据网络修正 coinType 地址
            if (network === 'testnet') {
              for (const [key, value] of Object.entries(params)) {
                if (typeof value === 'string' && mainnetToTestnetCoinTypeMap[value]) {
                  params[key] = mainnetToTestnetCoinTypeMap[value];
                }
              }
            }
            
            // 为 Cetus swap 步骤注入 poolId（如果 LLM 没有提供）
            if (s.toolName === 'cetus_swap' && !params.poolId) {
              // 使用 Cetus 的 pools_id 作为默认池子 ID
              params.poolId = cetusContracts.pools_id;
            }
            
            return {
              id: s.id || `step_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              protocol: s.toolName?.startsWith('cetus') ? 'cetus' as const : s.toolName?.startsWith('navi') ? 'navi' as const : 'sui' as const,
              action: s.toolName?.replace(/^(cetus|navi|sui)_/, '') || 'swap',
              description: s.description || `Execute ${s.toolName}`,
              params,
              dependsOn: s.dependsOn || [],
            };
          }),
          canMergeToPTB: true,
          summary: plan.summary || `Execute ${plan.steps.length} step(s)`,
        };

        // 使用编排器构建真实 PTB
        // 传递 signerAddress 以便处理未使用的 Coin（_leftoverCoin）
        const tx = await orchestrator.buildPlanTransaction(crossProtocolPlan, signerAddress);
        // 设置签名者地址（必须，否则 tx.build() 会报 "Missing transaction sender"）
        if (signerAddress) {
          tx.setSender(signerAddress);
        }

        // 使用 SuiJsonRpcClient 构建交易，它包含 core.resolveTransactionPlugin 方法，
        // 这是 tx.build() 所必需的（用于解析 UnresolvedObject 对象引用，如 pool 对象）。
        // 
        // 使用 onlyTransactionKind=true 构建交易，这样 gasData.payment 保持为 null，
        // 前端钱包收到后，coreClientResolveTransactionPlugin 检测到 needsPayment = true，
        // 会自动调用 listCoins 获取用户的 gas coin 并填充。
        // 
        // 注意：不能使用 onlyTransactionKind=false，因为 tx.build({ client }) 会调用
        // resolveTransactionPlugin 自动获取 gas coin 并填充 payment，导致前端钱包
        // 检测到 payment 有值（needsPayment = false），不会替换 gas coin。
        // 而 daemon 端获取的 gas coin 的 version/digest 可能已过时，导致链上验证失败。
        const { SuiJsonRpcClient } = await import('@mysten/sui/jsonRpc');
        const rpcUrl = getRpcUrl(network);
        const suiClient = new SuiJsonRpcClient({ url: rpcUrl, network });
        
        // 设置 sender 地址（必须，否则 tx.build() 会报 "Missing transaction sender"）
        if (signerAddress) {
          tx.setSender(signerAddress);
        }
        
        // 传 client 让 UnresolvedObject 对象引用被解析（如 pool 对象），
        // 但用 onlyTransactionKind=true 让 gasData.payment 保持为 null。
        const txBytes = await tx.build({ client: suiClient, onlyTransactionKind: true });
        
        // 将 txBytes 转为 base64 返回给前端
        const txBytesBase64 = Buffer.from(txBytes).toString('base64');

        return this.sendJson(res, 200, {
          success: true,
          txBytes: txBytesBase64,
          steps: plan.steps.length,
          message: 'Transaction built successfully. Sign with your wallet to execute.',
        });
      } catch (error: any) {
        console.error('[SuiIntent] Build transaction error:', error);
        return this.sendJson(res, 500, {
          success: false,
          error: `Failed to build transaction: ${error.message}`,
        });
      }
    }

    // AI test endpoint
    if (path === "/api/ai/test" && method === "POST") {
      try {
        const { provider, model, apiKey } = JSON.parse(body);

        if (!provider || !model || !apiKey) {
          return this.sendJson(res, 400, {
            success: false,
            error: "provider, model, and apiKey are required",
          });
        }

        console.log(
          `[Daemon] Testing AI config: provider=${provider}, model=${model}`,
        );

        // Import and use the AI service to perform a real connection test
        try {
          const { AI } = await import("../ai/ai.js");
          const ai = new AI();

          // Configure the AI service with the provided credentials
          await ai.configure({
            provider: provider as any,
            apiKey: apiKey,
            model: model,
          });

          // Perform actual connection test (makes real HTTP request to the provider's API)
          const testResult = await ai.testConnection();

          if (testResult.success) {
            return this.sendJson(res, 200, {
              success: true,
              message: `Successfully connected to ${provider} using model ${model}: ${testResult.message}`,
            });
          } else {
            return this.sendJson(res, 200, {
              success: false,
              message: `Connection test failed for ${provider}: ${testResult.message}`,
            });
          }
        } catch (serviceError: any) {
          console.warn(
            "[Daemon] AI service test failed:",
            serviceError.message,
          );
          return this.sendJson(res, 200, {
            success: false,
            message: `Connection test failed for ${provider}: ${serviceError.message}`,
          });
        }
      } catch (error: any) {
        console.error("[Daemon] AI config test error:", error);
        return this.sendJson(res, 200, {
          success: false,
          message: `Configuration test failed: ${error.message}`,
        });
      }
    }

    // Configuration endpoints
    if (path === "/api/config" && method === "GET") {
      try {
        const configManager = getConfigManager();
        const config = await configManager.getAll();
        return this.sendJson(res, 200, { config });
      } catch (error: any) {
        console.error("[Daemon] Error getting config:", error);
        return this.sendJson(res, 500, {
          error: "Failed to get configuration",
          message: error.message,
        });
      }
    }

    if (path === "/api/config" && method === "PUT") {
      try {
        const request = JSON.parse(body);
        const configManager = getConfigManager();

        // Support both formats:
        // 1. Direct format: { ai: {...}, registry: {...} }
        // 2. Nested format (from Web UI): { config: { ai: {...}, registry: {...} } }
        const config = request.config || request;

        // Update AI configuration
        if (config.ai) {
          if (config.ai.provider)
            await configManager.setAIProvider(config.ai.provider);
          if (config.ai.apiKey)
            await configManager.setAIAPIKey(config.ai.apiKey);
          if (config.ai.model) await configManager.setAIModel(config.ai.model);
        }

        // Update registry configuration
        if (config.registry) {
          if (config.registry.default)
            await configManager.setRegistryDefault(config.registry.default);
          if (config.registry.fallback)
            await configManager.setRegistryFallback(config.registry.fallback);
        }

        const updatedConfig = await configManager.getAll();
        return this.sendJson(res, 200, { config: updatedConfig });
      } catch (error: any) {
        console.error("[Daemon] Error updating config:", error);
        return this.sendJson(res, 500, {
          error: "Failed to update configuration",
          message: error.message,
        });
      }
    }

    // Secrets endpoints
    if (path === "/api/secrets" && method === "GET") {
      try {
        const secretManager = getSecretManager();
        const allSecrets = await secretManager.getAll();
        const secrets = Array.from(allSecrets.entries()).map(
          ([name, _value]) => ({
            name,
            value: "••••••••••••••••", // Mask the actual value
            lastUpdated: new Date().toISOString(),
          }),
        );
        return this.sendJson(res, 200, { secrets });
      } catch (error: any) {
        console.error("[Daemon] Error getting secrets:", error);
        return this.sendJson(res, 500, {
          error: "Failed to get secrets",
          message: error.message,
        });
      }
    }

    if (path === "/api/secrets" && method === "POST") {
      try {
        const request = JSON.parse(body);
        if (!request.name || !request.value) {
          return this.sendJson(res, 400, {
            error: "Bad Request",
            message: "name and value are required",
          });
        }

        const secretManager = getSecretManager();
        await secretManager.set(request.name, request.value);

        return this.sendJson(res, 201, {
          secret: {
            name: request.name,
            value: "••••••••••••••••", // Mask the actual value
            lastUpdated: new Date().toISOString(),
          },
        });
      } catch (error: any) {
        console.error("[Daemon] Error creating secret:", error);
        return this.sendJson(res, 500, {
          error: "Failed to create secret",
          message: error.message,
        });
      }
    }

    if (path.startsWith("/api/secrets/") && method === "DELETE") {
      try {
        const name = decodeURIComponent(path.substring("/api/secrets/".length));
        const secretManager = getSecretManager();
        await secretManager.remove(name);
        return this.sendJson(res, 200, { success: true });
      } catch (error: any) {
        console.error("[Daemon] Error deleting secret:", error);
        return this.sendJson(res, 500, {
          error: "Failed to delete secret",
          message: error.message,
        });
      }
    }

    return this.sendJson(res, 404, { error: "Not Found", path });
  }

  private sendJson(res: http.ServerResponse, c: number, d: any) {
    if (!res.headersSent) {
      res.writeHead(c, { "Content-Type": "application/json" });
      res.end(JSON.stringify(d));
    }
  }

  async start() {
    ensureInTorchDir();

    // Set environment variable to identify this as a daemon process
    process.env.INTORCH_DAEMON = "true";

    await fs.writeFile(this.config.pidFile, process.pid.toString());

    // Generate daemon auth token if not exists
    await this.ensureAuthToken();

    // Start the HTTP server
    return new Promise<void>(async (resolve) => {
      this.server.listen(this.config.port, this.config.host, async () => {
        console.log(
          `[Daemon] Server started on ${this.config.host}:${this.config.port}`,
        );

        // Auto-start configured MCP servers in background
        this.autoStartServers().catch((error) => {
          console.error("[Daemon] Error auto-starting servers:", error);
        });

        // Initialize health check scheduler for all running servers
        this.initHealthCheckScheduler().catch((error) => {
          console.error(
            "[Daemon] Error initializing health check scheduler:",
            error,
          );
        });

        resolve();
      });
    });
  }

  /**
   * Ensure daemon auth token exists, generate one if not
   */
  private async ensureAuthToken(): Promise<void> {
    try {
      const secretManager = getSecretManager();
      const existingToken = await secretManager.get("daemon_auth_token");

      if (!existingToken) {
        const crypto = await import("crypto");
        const newToken = crypto.randomBytes(32).toString("hex");
        await secretManager.set("daemon_auth_token", newToken);
        console.log("[Daemon] Generated new auth token");
      } else {
        console.log("[Daemon] Using existing auth token");
      }
    } catch (error) {
      console.error("[Daemon] Failed to ensure auth token:", error);
    }
  }

  /**
   * Initialize health check scheduler for all running MCP servers
   * Registers each running server with a health check function and starts periodic monitoring
   */
  private async initHealthCheckScheduler(): Promise<void> {
    try {
      console.log("[Daemon] Initializing health check scheduler...");

      // Get all running servers
      const processManager = getProcessManager();
      const runningServers = await processManager.list();
      const runningProcesses = runningServers.filter(
        (p) => p.status === "running",
      );

      if (runningProcesses.length === 0) {
        console.log(
          "[Daemon] No running servers to register for health checks",
        );
        return;
      }

      console.log(
        `[Daemon] Registering ${runningProcesses.length} running servers for health checks`,
      );

      for (const server of runningProcesses) {
        const serverName =
          server.serverName || server.name || `server-${server.pid}`;

        // Register a health check function that pings the server process
        healthCheckScheduler.registerServer(serverName, async () => {
          try {
            // Check if the process is still running
            const processInfo = await processManager.get(server.pid);
            return processInfo !== null && processInfo?.status === "running";
          } catch {
            return false;
          }
        });

        console.log(
          `[Daemon] Registered health check for server: ${serverName} (PID: ${server.pid})`,
        );
      }

      // Listen for health state changes
      healthCheckScheduler.on("degraded", (result) => {
        console.warn(
          `[Daemon] Health check: Server "${result.serverName}" is DEGRADED (${result.consecutiveFailures} consecutive failures)`,
        );
      });

      healthCheckScheduler.on("recovered", (result) => {
        console.log(
          `[Daemon] Health check: Server "${result.serverName}" RECOVERED`,
        );
      });

      // Start the scheduler
      healthCheckScheduler.start();
      console.log("[Daemon] Health check scheduler started successfully");
    } catch (error) {
      console.error(
        "[Daemon] Failed to initialize health check scheduler:",
        error,
      );
    }
  }

  /**
   * Register a newly started server with the health check scheduler
   */
  private async registerServerHealthCheck(
    serverName: string,
    pid: number,
  ): Promise<void> {
    try {
      const processManager = getProcessManager();

      healthCheckScheduler.registerServer(serverName, async () => {
        try {
          const processInfo = await processManager.get(pid);
          return processInfo !== null && processInfo?.status === "running";
        } catch {
          return false;
        }
      });

      console.log(
        `[Daemon] Registered health check for newly started server: ${serverName} (PID: ${pid})`,
      );
    } catch (error) {
      console.error(
        `[Daemon] Failed to register health check for server ${serverName}:`,
        error,
      );
    }
  }

  /**
   * Auto-start configured MCP servers
   */
  private async autoStartServers(): Promise<void> {
    try {
      console.log("[Daemon] Starting auto-start manager for MCP servers...");

      // Import AutoStartManager
      const { AutoStartManager } =
        await import("../utils/auto-start-manager.js");
      const autoStartManager = new AutoStartManager();

      // Get configured servers from environment or config file
      const configuredServers = await this.getConfiguredServers();

      if (configuredServers.length === 0) {
        console.log("[Daemon] No servers configured for auto-start");
        return;
      }

      console.log(
        `[Daemon] Found ${configuredServers.length} configured servers: ${configuredServers.join(", ")}`,
      );

      // Ensure servers are running
      const results =
        await autoStartManager.ensureServersRunning(configuredServers);

      // Print results
      const summary = autoStartManager.getResultsSummary(results);
      console.log(
        `[Daemon] Auto-start completed: ${summary.successful} started, ${summary.alreadyRunning} already running, ${summary.failed} failed`,
      );

      if (summary.failed > 0) {
        console.warn(
          "[Daemon] Some servers failed to start. Check logs for details.",
        );
      }

      // After servers are started, ensure tools are registered
      // Wait longer for servers to fully initialize
      await new Promise((resolve) => setTimeout(resolve, 5000));
      await this.ensureToolsRegistered(configuredServers);
    } catch (error) {
      console.error("[Daemon] Failed to auto-start servers:", error);
    }
  }

  /**
   * Get configured servers from environment or config file
   */
  private async getConfiguredServers(): Promise<string[]> {
    // First, check environment variable (for backward compatibility)
    const envServers = process.env.INTORCH_AUTO_START_SERVERS;
    if (envServers) {
      return envServers
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }

    // Then check configuration file
    try {
      const configManager = getConfigManager();
      const config = await configManager.getAll();
      if (
        config.services &&
        config.services.autoStart &&
        Array.isArray(config.services.autoStart)
      ) {
        return config.services.autoStart;
      }
    } catch (error) {
      console.warn("[Daemon] Failed to read auto-start configuration:", error);
    }

    // Default servers if none configured
    // Note: This is a generic default, not hardcoded to specific services
    return [];
  }

  /**
   * Ensure tools are registered for running servers
   */
  private async ensureToolsRegistered(serverNames: string[]): Promise<void> {
    try {
      console.log("[Daemon] Ensuring tools are registered for servers...");

      const processManager = getProcessManager();
      const toolRegistry = getToolRegistry();
      const registryClient = getRegistryClient();

      // Wait a moment for servers to fully start
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Get all running servers
      const runningServers = await processManager.list();
      console.log(`[Daemon] Found ${runningServers.length} running servers`);

      for (const serverName of serverNames) {
        try {
          // Try to find server by name (exact match or partial match)
          // Since we have multiple instances with same name, use the first running one
          const serverInfo = runningServers.find(
            (s) =>
              s.status === "running" &&
              (s.serverName === serverName ||
                s.name === serverName ||
                (s.manifest &&
                  s.manifest.name &&
                  serverName.includes(s.manifest.name)) ||
                serverName.includes(s.name || "")),
          );

          if (!serverInfo) {
            console.log(
              `[Daemon] Server ${serverName} is not running or not found, skipping tool registration`,
            );
            console.log(
              `[Daemon] Available servers: ${runningServers.map((s) => `${s.serverName || s.name} (PID: ${s.pid}, status: ${s.status})`).join(", ")}`,
            );
            continue;
          }

          console.log(
            `[Daemon] Registering tools for server: ${serverName} (PID: ${serverInfo.pid})`,
          );

          // Get manifest
          const manifest = await registryClient.getCachedManifest(serverName);
          if (!manifest) {
            console.warn(`[Daemon] No manifest found for server ${serverName}`);
            continue;
          }

          // Check if manifest has tools
          const hasTools =
            manifest.tools ||
            (manifest.capabilities && manifest.capabilities.tools);
          if (!hasTools) {
            console.log(
              `[Daemon] Manifest for ${serverName} has no tools field, trying dynamic discovery`,
            );
            // Try to discover tools dynamically
            await this.discoverToolsDynamically(serverInfo);
          } else {
            // Register tools from manifest
            await toolRegistry.registerToolsFromManifest(serverName, manifest);
            console.log(
              `[Daemon] Tools registered from manifest for server: ${serverName}`,
            );
          }
        } catch (serverError) {
          console.error(
            `[Daemon] Error registering tools for server ${serverName}:`,
            serverError,
          );
        }
      }

      console.log("[Daemon] Tool registration completed");
    } catch (error) {
      console.error("[Daemon] Failed to ensure tools are registered:", error);
    }
  }

  /**
   * Discover tools dynamically from a running MCP server
   */
  private async discoverToolsDynamically(serverInfo: any): Promise<void> {
    try {
      console.log(
        `[Daemon] Attempting dynamic tool discovery for server: ${serverInfo.name}`,
      );

      // Import MCPClient
      const { MCPClient } = await import("../mcp/client.js");

      // Create client configuration from server manifest
      const client = new MCPClient({
        transport: {
          type: "stdio",
          command: serverInfo.manifest.runtime.command,
          args: serverInfo.manifest.runtime.args || [],
          env: { ...process.env } as Record<string, string>,
        },
      });

      // Handle transport errors to prevent process crash
      client.on("error", (error) => {
        console.warn(
          `[Daemon] MCP Client error for ${serverInfo.name} during discovery: ${error.message || error}`,
        );
      });

      // Connect to server
      await client.connect();
      // List tools
      const tools = await client.listTools();
      console.log(
        `[Daemon] Discovered ${tools.length} tools dynamically from server ${serverInfo.name}`,
      );

      // Register tools using registerDynamicTools method
      const toolRegistry = getToolRegistry();
      const toolMetadataArray = tools.map((tool) => ({
        name: tool.name,
        description: tool.description || "",
        serverName: serverInfo.serverName,
        actualServerName: serverInfo.name,
        parameters: tool.inputSchema?.properties || {},
        isDynamic: true,
        discoveryTime: new Date().toISOString(),
      }));

      await toolRegistry.registerDynamicTools(
        serverInfo.serverName,
        toolMetadataArray,
      );

      await client.disconnect();
      console.log(
        `[Daemon] Dynamic tool discovery completed for ${serverInfo.name}`,
      );
    } catch (error) {
      console.error(
        `[Daemon] Failed to discover tools dynamically for ${serverInfo.name}:`,
        error,
      );
    }
  }

  async stop() {
    return new Promise<void>((r) => this.server.close(() => r()));
  }
}
