import http from 'http';
import fs from 'fs/promises';
import { 
  ensureInTorchDir,
  getDaemonPidPath,
  getDaemonLogPath,
  healthCheckScheduler
} from '@intentorch/core';
import type { DaemonConfig } from '@intentorch/core';
import { authMiddleware } from './routes/auth';
import { handleStatusRoutes, type RouteContext } from './routes/status';
import { handleServerRoutes } from './routes/servers';
import { handleWorkflowRoutes } from './routes/workflows';
import { handleExecutionRoutes } from './routes/execution';
import { handleConfigRoutes } from './routes/config';
import { handleSecretsRoutes } from './routes/secrets';
import { handleAuthRoutes } from './routes/auth';
import { handleNotificationRoutes } from './routes/notifications';
import { handleAIRoutes } from './routes/ai';
import { handleSuiIntentRoutes } from './routes/sui-intent';

export class DaemonServer {
  private server: http.Server;
  private config: DaemonConfig;
  private startTime: number;
  private requestCount: number;

  constructor(config: Partial<DaemonConfig> = {}) {
    this.config = {
      port: config.port || 9658,
      host: config.host || 'localhost',
      pidFile: config.pidFile || getDaemonPidPath(),
      logFile: config.logFile || getDaemonLogPath()
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
        console.error('[Daemon Error]', e);
        this.sendJson(res, 500, { error: 'Internal Error', message: (e as Error).message });
      }
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const method = req.method || 'GET';
    const parsedUrl = new URL(req.url || '/', 'http://localhost');
    const path = parsedUrl.pathname;

    if (method !== 'OPTIONS') this.requestCount++;

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');

    if (method === 'OPTIONS') return res.writeHead(200).end();

    console.log(`[Daemon] ${method} ${path}`);

    // Auth middleware
    const authenticated = await authMiddleware(req, res);
    if (!authenticated) return;

    // Parse body for POST/PUT
    let body = '';
    if (method === 'POST' || method === 'PUT') {
      body = await new Promise<string>((resolve, reject) => {
        let b = '';
        req.on('data', c => b += c);
        req.on('end', () => resolve(b));
        req.on('error', reject);
      });
    }

    // Build route context
    const ctx: RouteContext = {
      req, res, path, method, body, parsedUrl,
      config: this.config,
      startTime: this.startTime,
      requestCount: this.requestCount
    };

    // Route dispatch — each handler returns true if it matched
    if (await handleStatusRoutes(ctx)) return;
    if (await handleServerRoutes(ctx)) return;
    if (await handleWorkflowRoutes(ctx)) return;
    if (await handleExecutionRoutes(ctx)) return;
    if (await handleConfigRoutes(ctx)) return;
    if (await handleSecretsRoutes(ctx)) return;
    if (await handleAuthRoutes(ctx)) return;
    if (await handleNotificationRoutes(ctx)) return;
    if (await handleAIRoutes(ctx)) return;
    if (await handleSuiIntentRoutes(ctx)) return;

    this.sendJson(res, 404, { error: 'Not Found', path });
  }

  private sendJson(res: http.ServerResponse, c: number, d: any) {
    if (!res.headersSent) {
      res.writeHead(c, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(d));
    }
  }

  async start() {
    ensureInTorchDir();
    await fs.writeFile(this.config.pidFile, process.pid.toString());

    return new Promise<void>((resolve) => {
      this.server.listen(this.config.port, this.config.host, async () => {
        console.log(`[Daemon] Server started on ${this.config.host}:${this.config.port}`);

        this.autoStartServers().catch(error => {
          console.error('[Daemon] Error auto-starting servers:', error);
        });

        this.initHealthCheckScheduler().catch(error => {
          console.error('[Daemon] Error initializing health check scheduler:', error);
        });

        resolve();
      });
    });
  }

  private async initHealthCheckScheduler(): Promise<void> {
    try {
      console.log('[Daemon] Initializing health check scheduler...');
      const { getProcessManager } = await import('@intentorch/core');
      const runningServers = await getProcessManager().list();
      const runningProcesses = runningServers.filter(p => p.status === 'running');

      if (runningProcesses.length === 0) {
        console.log('[Daemon] No running servers to register for health checks');
        return;
      }

      console.log(`[Daemon] Registering ${runningProcesses.length} running servers for health checks`);

      for (const server of runningProcesses) {
        const serverName = server.serverName || server.name || `server-${server.pid}`;
        const processManager = getProcessManager();

        healthCheckScheduler.registerServer(serverName, async () => {
          try {
            const processInfo = await processManager.get(server.pid);
            return processInfo !== null && processInfo?.status === 'running';
          } catch {
            return false;
          }
        });

        console.log(`[Daemon] Registered health check for server: ${serverName} (PID: ${server.pid})`);
      }

      healthCheckScheduler.on('degraded', (result) => {
        console.warn(`[Daemon] Health check: Server "${result.serverName}" is DEGRADED (${result.consecutiveFailures} consecutive failures)`);
      });

      healthCheckScheduler.on('recovered', (result) => {
        console.log(`[Daemon] Health check: Server "${result.serverName}" RECOVERED`);
      });

      healthCheckScheduler.start();
      console.log('[Daemon] Health check scheduler started successfully');
    } catch (error) {
      console.error('[Daemon] Failed to initialize health check scheduler:', error);
    }
  }

  private async autoStartServers(): Promise<void> {
    try {
      console.log('[Daemon] Starting auto-start manager for MCP servers...');
      const { AutoStartManager } = await import('@intentorch/core');
      const autoStartManager = new AutoStartManager();
      const configuredServers = await this.getConfiguredServers();

      if (configuredServers.length === 0) {
        console.log('[Daemon] No servers configured for auto-start');
        return;
      }

      console.log(`[Daemon] Found ${configuredServers.length} configured servers: ${configuredServers.join(', ')}`);
      const results = await autoStartManager.ensureServersRunning(configuredServers);
      const summary = autoStartManager.getResultsSummary(results);
      console.log(`[Daemon] Auto-start completed: ${summary.successful} started, ${summary.alreadyRunning} already running, ${summary.failed} failed`);

      if (summary.failed > 0) {
        console.warn('[Daemon] Some servers failed to start. Check logs for details.');
      }

      await new Promise(resolve => setTimeout(resolve, 5000));
      await this.ensureToolsRegistered(configuredServers);
    } catch (error) {
      console.error('[Daemon] Failed to auto-start servers:', error);
    }
  }

  private async getConfiguredServers(): Promise<string[]> {
    const envServers = process.env.INTORCH_AUTO_START_SERVERS;
    if (envServers) {
      return envServers.split(',').map(s => s.trim()).filter(s => s.length > 0);
    }

    try {
      const { getConfigManager } = await import('@intentorch/core');
      const config = await getConfigManager().getAll();
      if (config.services && config.services.autoStart && Array.isArray(config.services.autoStart)) {
        return config.services.autoStart;
      }
    } catch (error) {
      console.warn('[Daemon] Failed to read auto-start configuration:', error);
    }

    return [];
  }

  private async ensureToolsRegistered(serverNames: string[]): Promise<void> {
    try {
      console.log('[Daemon] Ensuring tools are registered for servers...');
      const { getProcessManager, getToolRegistry, getRegistryClient, MCPClient } = await import('@intentorch/core');
      const processManager = getProcessManager();
      const toolRegistry = getToolRegistry();
      const registryClient = getRegistryClient();

      await new Promise(resolve => setTimeout(resolve, 2000));
      const runningServers = await processManager.list();
      console.log(`[Daemon] Found ${runningServers.length} running servers`);

      for (const serverName of serverNames) {
        try {
          const serverInfo = runningServers.find(s =>
            s.status === 'running' && (
              s.serverName === serverName ||
              s.name === serverName ||
              (s.manifest && s.manifest.name && serverName.includes(s.manifest.name)) ||
              serverName.includes(s.name || '')
            )
          );

          if (!serverInfo) {
            console.log(`[Daemon] Server ${serverName} is not running or not found, skipping tool registration`);
            continue;
          }

          console.log(`[Daemon] Registering tools for server: ${serverName} (PID: ${serverInfo.pid})`);
          const manifest = await registryClient.getCachedManifest(serverName);
          if (!manifest) {
            console.warn(`[Daemon] No manifest found for server ${serverName}`);
            continue;
          }

          const hasTools = manifest.tools || (manifest.capabilities && manifest.capabilities.tools);
          if (!hasTools) {
            console.log(`[Daemon] Manifest for ${serverName} has no tools field, trying dynamic discovery`);
            await this.discoverToolsDynamically(serverInfo);
          } else {
            await toolRegistry.registerToolsFromManifest(serverName, manifest);
            console.log(`[Daemon] Tools registered from manifest for server: ${serverName}`);
          }
        } catch (serverError) {
          console.error(`[Daemon] Error registering tools for server ${serverName}:`, serverError);
        }
      }

      console.log('[Daemon] Tool registration completed');
    } catch (error) {
      console.error('[Daemon] Failed to ensure tools are registered:', error);
    }
  }

  private async discoverToolsDynamically(serverInfo: any): Promise<void> {
    try {
      console.log(`[Daemon] Attempting dynamic tool discovery for server: ${serverInfo.name}`);
      const { MCPClient, getToolRegistry } = await import('@intentorch/core');

      const client = new MCPClient({
        transport: {
          type: 'stdio',
          command: serverInfo.manifest.runtime.command,
          args: serverInfo.manifest.runtime.args || [],
          env: { ...process.env } as Record<string, string>
        }
      });

      client.on('error', (error) => {
        console.warn(`[Daemon] MCP Client error for ${serverInfo.name} during discovery: ${error.message || error}`);
      });

      await client.connect();
      const tools = await client.listTools();
      console.log(`[Daemon] Discovered ${tools.length} tools dynamically from server ${serverInfo.name}`);

      const toolRegistry = getToolRegistry();
      const toolMetadataArray = tools.map(tool => ({
        name: tool.name,
        description: tool.description || '',
        serverName: serverInfo.serverName,
        actualServerName: serverInfo.name,
        parameters: tool.inputSchema?.properties || {},
        isDynamic: true,
        discoveryTime: new Date().toISOString()
      }));

      await toolRegistry.registerDynamicTools(serverInfo.serverName, toolMetadataArray);
      await client.disconnect();
      console.log(`[Daemon] Dynamic tool discovery completed for ${serverInfo.name}`);
    } catch (error) {
      console.error(`[Daemon] Failed to discover tools dynamically for ${serverInfo.name}:`, error);
    }
  }

  async stop() {
    return new Promise<void>(r => this.server.close(() => r()));
  }
}
