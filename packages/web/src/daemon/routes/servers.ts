import http from 'http';
import fs from 'fs/promises';
import { getProcessManager, getRegistryClient, getToolRegistry, MCPClient, getLogPath } from '@intentorch/core';
import type { RouteContext } from './status';

/**
 * Server management routes
 * - GET /api/servers
 * - POST /api/servers
 * - POST /api/servers/pull
 * - POST /api/servers/import
 * - GET /api/servers/search
 * - GET /api/servers/cached
 * - GET /api/servers/{id}
 * - GET /api/servers/{name}/tools
 * - GET /api/servers/{id}/logs
 * - DELETE /api/servers/{id}
 */
export async function handleServerRoutes(ctx: RouteContext): Promise<boolean> {
  const { path, method, res, body } = ctx;

  // GET /api/servers
  if (path === '/api/servers' && method === 'GET') {
    sendJson(res, 200, { servers: await getProcessManager().list() });
    return true;
  }

  // POST /api/servers (start a server)
  if (path === '/api/servers' && method === 'POST') {
    return handleStartServer(res, body);
  }

  // POST /api/servers/pull
  if (path === '/api/servers/pull' && method === 'POST') {
    return handlePullServer(res, body);
  }

  // POST /api/servers/import
  if (path === '/api/servers/import' && method === 'POST') {
    return handleImportConfig(res, body);
  }

  // GET /api/servers/search
  if (path === '/api/servers/search' && method === 'GET') {
    const query = ctx.parsedUrl.searchParams.get('q') || '';
    const source = ctx.parsedUrl.searchParams.get('source') || 'all';
    sendJson(res, 200, await getRegistryClient().searchServices({ query, source }));
    return true;
  }

  // GET /api/servers/cached
  if (path === '/api/servers/cached' && method === 'GET') {
    const cachedManifests = await getRegistryClient().listCachedManifests();
    const services = cachedManifests.map(name => ({
      name,
      description: `Cached MCP Server: ${name}`,
      version: 'unknown',
      source: 'local',
      tags: ['cached', 'local'],
      lastUpdated: new Date().toISOString().split('T')[0]
    }));
    sendJson(res, 200, { services, total: services.length, source: 'local', hasMore: false });
    return true;
  }

  // GET /api/servers/{name}/tools
  const toolsMatch = path.match(/^\/api\/servers\/([^\/]+)\/tools$/);
  if (toolsMatch && method === 'GET') {
    return handleServerTools(res, decodeURIComponent(toolsMatch[1]));
  }

  // GET /api/servers/{id}/logs
  const logsMatch = path.match(/^\/api\/servers\/(\d+)\/logs$/);
  if (logsMatch && method === 'GET') {
    return handleServerLogs(res, parseInt(logsMatch[1], 10));
  }

  // GET /api/servers/{id}
  const idMatch = path.match(/^\/api\/servers\/(\d+)$/);
  if (idMatch && method === 'GET') {
    const pid = parseInt(idMatch[1], 10);
    const processInfo = await getProcessManager().get(pid);
    if (!processInfo) {
      sendJson(res, 404, { error: 'Not Found', message: `Server with PID ${pid} not found` });
    } else {
      sendJson(res, 200, processInfo);
    }
    return true;
  }

  // DELETE /api/servers/{id}
  const deleteMatch = path.match(/^\/api\/servers\/(\d+)$/);
  if (deleteMatch && method === 'DELETE') {
    return handleStopServer(res, parseInt(deleteMatch[1], 10));
  }

  return false;
}

async function handleImportConfig(res: http.ServerResponse, body: string): Promise<true> {
  try {
    const { config } = JSON.parse(body);
    if (!config || typeof config !== 'string') {
      sendJson(res, 400, { error: 'Bad Request', message: 'config is required and must be a JSON string' });
      return true;
    }

    const manifests = await getRegistryClient().importConfig(config);
    
    sendJson(res, 200, {
      success: true,
      message: `Successfully imported ${manifests.length} MCP server(s)`,
      imported: manifests.map(m => ({
        name: m.name,
        version: m.version,
        description: m.description
      })),
      total: manifests.length
    });
  } catch (error: any) {
    if (error instanceof SyntaxError) {
      sendJson(res, 400, { error: 'Invalid JSON', message: 'Request body must be valid JSON' });
    } else {
      sendJson(res, 400, { 
        success: false, 
        error: 'Import Failed', 
        message: error.message,
        suggestion: 'Please check that the config is valid Claude Desktop format (has "mcpServers" field)'
      });
    }
  }
  return true;
}

async function handleStartServer(res: http.ServerResponse, body: string): Promise<true> {
  try {
    const { serverNameOrUrl } = JSON.parse(body);
    if (!serverNameOrUrl || typeof serverNameOrUrl !== 'string') {
      sendJson(res, 400, { error: 'Bad Request', message: 'serverNameOrUrl is required and must be a string' });
      return true;
    }

    const manifest = await getRegistryClient().fetchManifest(serverNameOrUrl);
    await getToolRegistry().registerToolsFromManifest(serverNameOrUrl, manifest);

    const existingProcesses = await getProcessManager().list();
    const runningServer = existingProcesses.find(p =>
      p.manifest && p.manifest.name === manifest.name && p.status === 'running'
    );

    if (runningServer) {
      sendJson(res, 200, {
        pid: runningServer.pid,
        name: runningServer.name || runningServer.manifest.name,
        version: runningServer.version || runningServer.manifest.version,
        status: runningServer.status,
        logPath: runningServer.logPath || getLogPath(runningServer.pid),
        alreadyRunning: true
      });
      return true;
    }

    const pid = await getProcessManager().start(serverNameOrUrl);
    const processInfo = await getProcessManager().get(pid);

    if (!processInfo) {
      sendJson(res, 500, {
        error: 'Server Startup Failed',
        message: `Failed to retrieve process info for PID ${pid}`,
        suggestion: 'Check if the process started successfully'
      });
      return true;
    }

    sendJson(res, 201, {
      pid: processInfo.pid,
      name: processInfo.name || processInfo.manifest.name,
      version: processInfo.version || processInfo.manifest.version,
      status: processInfo.status,
      logPath: processInfo.logPath || getLogPath(processInfo.pid),
      alreadyRunning: false
    });
  } catch (error: any) {
    if (error instanceof SyntaxError) {
      sendJson(res, 400, { error: 'Invalid JSON', message: 'Request body must be valid JSON' });
      return true;
    }
    try {
      const { serverNameOrUrl } = JSON.parse(body);
      const manifest = await getRegistryClient().getCachedManifest(serverNameOrUrl);
      if (manifest) {
        sendJson(res, 500, {
          error: 'Server Startup Failed',
          message: `Failed to start server: ${error.message}`,
          details: { manifestName: manifest.name, manifestVersion: manifest.version, manifestDescription: manifest.description, suggestion: 'Check server configuration and required secrets' }
        });
        return true;
      }
    } catch { /* ignore */ }
    sendJson(res, 500, { error: 'Server Startup Failed', message: `Failed to start server: ${error.message}`, suggestion: 'Check if the server name/URL is valid and all required secrets are set' });
  }
  return true;
}

async function handlePullServer(res: http.ServerResponse, body: string): Promise<true> {
  try {
    const { serverNameOrUrl } = JSON.parse(body);
    if (!serverNameOrUrl || typeof serverNameOrUrl !== 'string') {
      sendJson(res, 400, { error: 'Bad Request', message: 'serverNameOrUrl is required and must be a string' });
      return true;
    }

    const manifest = await getRegistryClient().fetchManifest(serverNameOrUrl);
    console.log('[Daemon] Pulled manifest:', JSON.stringify(manifest, null, 2).substring(0, 500));
    await getToolRegistry().registerToolsFromManifest(serverNameOrUrl, manifest);

    sendJson(res, 200, {
      success: true,
      message: `Successfully pulled and cached manifest for ${manifest.name}`,
      manifest: { name: manifest.name, version: manifest.version, description: manifest.description }
    });
  } catch (error: any) {
    if (error instanceof SyntaxError) {
      sendJson(res, 400, { error: 'Invalid JSON', message: 'Request body must be valid JSON' });
    } else {
      sendJson(res, 400, { success: false, error: 'Manifest Pull Failed', message: `Failed to pull manifest: ${error.message}`, suggestion: 'Check if the server name/URL is valid and accessible' });
    }
  }
  return true;
}

async function handleServerTools(res: http.ServerResponse, serverName: string): Promise<true> {
  try {
    console.log(`[Daemon] Fetching tools for server: ${serverName}`);
    const processManager = getProcessManager();
    const allProcesses = await processManager.list();
    const serverProcess = allProcesses.find(p =>
      p.serverName === serverName || p.name === serverName || (p.manifest && p.manifest.name === serverName)
    );

    if (!serverProcess) {
      sendJson(res, 404, { error: 'Not Found', message: `Server "${serverName}" not found` });
      return true;
    }

    const registryClient = getRegistryClient();
    let manifest = await registryClient.getCachedManifest(serverName);
    if (!manifest) manifest = serverProcess.manifest;

    if (!manifest || !manifest.runtime) {
      sendJson(res, 500, { error: 'Internal Server Error', message: `No runtime configuration found for server "${serverName}"` });
      return true;
    }

    const client = new MCPClient({
      transport: {
        type: 'stdio',
        command: manifest.runtime.command,
        args: manifest.runtime.args || [],
        env: { ...process.env } as Record<string, string>
      }
    });

    client.on('error', (error) => {
      console.warn(`[Daemon] MCP Client error for ${serverName}: ${error.message || error}`);
    });

    await client.connect();
    const tools = await client.listTools();
    await client.disconnect();

    sendJson(res, 200, tools);
  } catch (error: any) {
    console.error(`[Daemon] Error fetching tools for server ${serverName}:`, error);
    sendJson(res, 500, { error: 'Failed to fetch tools', message: error.message });
  }
  return true;
}

async function handleServerLogs(res: http.ServerResponse, pid: number): Promise<true> {
  const processInfo = await getProcessManager().get(pid);
  if (!processInfo) {
    sendJson(res, 404, { error: 'Not Found', message: `Server with PID ${pid} not found` });
    return true;
  }

  try {
    const logPath = getLogPath(pid);
    const logContent = await fs.readFile(logPath, 'utf-8');
    sendJson(res, 200, { pid, logs: logContent, logPath });
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      sendJson(res, 404, { error: 'Logs Not Found', message: `Log file for PID ${pid} not found` });
    } else {
      sendJson(res, 500, { error: 'Internal Server Error', message: `Failed to read logs: ${error.message}` });
    }
  }
  return true;
}

async function handleStopServer(res: http.ServerResponse, pid: number): Promise<true> {
  const processInfo = await getProcessManager().get(pid);
  if (!processInfo) {
    sendJson(res, 404, { error: 'Not Found', message: `Server with PID ${pid} not found` });
    return true;
  }

  if (processInfo.status === 'stopped') {
    sendJson(res, 200, { success: true, message: `Server with PID ${pid} is already stopped`, pid });
    return true;
  }

  try {
    await getProcessManager().stop(pid);
    sendJson(res, 200, { success: true, message: `Server with PID ${pid} stopped successfully`, pid });
  } catch (error: any) {
    sendJson(res, 500, { error: 'Failed to Stop Server', message: `Failed to stop server: ${error.message}` });
  }
  return true;
}

function sendJson(res: http.ServerResponse, c: number, d: any) {
  if (!res.headersSent) {
    res.writeHead(c, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(d));
  }
}
