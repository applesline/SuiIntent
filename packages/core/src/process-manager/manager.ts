import { logger } from "../core/logger";
import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import { ProcessInfo } from './types';
import { ProcessStoreManager } from './store';
import { getSecretManager } from '../secret/manager';
import { getRegistryClient } from '../registry/client';
import { getLogPath, ensureInTorchDir } from '../utils/paths';
import { isProcessRunningWithRetry } from '../utils/system';
import { PROGRAM_NAME } from '../utils/constants';
import { MCPClient } from '../mcp/client';
import { getToolRegistry } from '../tool-registry/registry';

export class ProcessManager {
  private store: ProcessStoreManager;
  private processes: Map<number, ChildProcess> = new Map();

  constructor() {
    this.store = new ProcessStoreManager();
  }

  async start(serverNameOrUrl: string): Promise<number> {
    ensureInTorchDir();
    
    // Get manifest
    const registryClient = getRegistryClient();
    const manifest = await registryClient.fetchManifest(serverNameOrUrl);
    
    // Check if the same server is already running
    const existingProcesses = await this.list();
    const runningServer = existingProcesses.find(p => 
      p.manifest.name === manifest.name && p.status === 'running'
    );
    
    if (runningServer) {
      // Server is already running, return the existing PID
      logger.info(`ℹ️  Server "${manifest.name}" is already running (PID: ${runningServer.pid})`);
      logger.info(`   Returning existing process instead of creating a new one`);
      return runningServer.pid;
    }

    // Check required secrets
    const secretManager = getSecretManager();
    const envVars: Record<string, string> = {};
    
    if (manifest.runtime.env && manifest.runtime.env.length > 0) {
      for (const envName of manifest.runtime.env) {
        const value = await secretManager.get(envName);
        if (!value) {
          // Friendly error message with clear guidance
          throw new Error(
            `❌ Startup failed: Server "${manifest.name}" requires secret [${envName}] which is not set.\n` +
            `   Please set the secret by running:\n` +
            `   ${PROGRAM_NAME} secret set ${envName} <your-value>\n` +
            `   Example: ${PROGRAM_NAME} secret set ${envName} "your-secret-value-here"`
          );
        }
        envVars[envName] = value;
      }
    }

    // Prepare log file
    // We'll use child.pid once it's started, but we need to pass a fd to spawn.
    // However, we don't know the PID until it starts.
    // For background processes, we'll open a temporary log file or use a predicted PID (not reliable).
    // Better: spawn first with pipe, then redirect in the child, but we want detached.
    // Standard approach: open file with a placeholder name or use a unique ID.
    // Since we want log per PID, we can start the process, get its PID, then redirect? 
    // No, spawn needs the fd.
    // Let's use a temporary filename and rename it, or just use PID.log.
    // Most OS provide the PID immediately after spawn.
    
    // Actually, we can't get PID before spawn.
    // We'll use a temporary log file and then rename it in the parent?
    // Or just use a unique ID.
    // Use a unique temp log path with random suffix to avoid collisions
    // getLogPath expects a number, so we use a large random number unlikely to collide
    const tempLogId = Date.now() + Math.floor(Math.random() * 100000);
    const tempLogPath = getLogPath(tempLogId);
    const logFile = fs.openSync(tempLogPath, 'a');

    // Start process as detached so it can continue after CLI exits
    // For MCP Servers, we need to handle different types:
    // 1. Stdio servers (communicate via stdin/stdout) - need to keep stdio open
    // 2. HTTP servers (listen on a port) - can ignore stdio
    // Determine transport type (default to stdio for backward compatibility)
    const transportType = manifest.transport?.type || 'stdio';
    
    let spawnOptions: any = {
      env: { ...process.env, ...envVars },
      shell: false
    };
    
    // Determine if this is a network-based server (HTTP, SSE, WebSocket, etc.)
    // These servers don't need stdin as they communicate via network
    const isNetworkServer = ['http', 'sse', 'websocket', 'tcp'].includes(transportType);
    
    if (isNetworkServer) {
      // Network servers can be fully detached and don't need stdin
      spawnOptions = {
        ...spawnOptions,
        stdio: ['ignore', logFile, logFile],
        detached: true
      };
    } else {
      // Stdio servers need to keep stdin/stdout open for MCP protocol communication
      // stdin: pipe (for sending JSON-RPC requests)
      // stdout: pipe (for receiving JSON-RPC responses via MCP protocol)
      // stderr: logFile (for logging/debug output)
      // We keep the process attached to maintain stdio connection
      // but also want it to survive parent exit
      spawnOptions = {
        ...spawnOptions,
        stdio: ['pipe', 'pipe', logFile],
        detached: true  // Still detached, but we keep stdio pipes open
      };
    }
    
    const child = spawn(manifest.runtime.command, manifest.runtime.args, spawnOptions);
    
    // Only close stdin for network servers, not for stdio servers
    if (isNetworkServer && child.stdin) {
      child.stdin.end();
    }
    
    const pid = child.pid!;
    const finalLogPath = getLogPath(pid);
    
    // Rename temporary log to PID log
    try {
      fs.closeSync(logFile);
      fs.renameSync(tempLogPath, finalLogPath);
    } catch (e) {
      // If rename fails (e.g. file busy), clean up the temp file
      try { fs.unlinkSync(tempLogPath); } catch (e2) { /* ignore */ }
    }

    // For detached processes, the exit event may not fire reliably
    // We'll rely on the store's process checking logic
    child.on('exit', async (code) => {
      try {
        const status = code === 0 ? 'stopped' : 'error';
        await this.store.updateProcess(pid, { status });
        this.processes.delete(pid);
      } catch (e) {
        // Ignore errors in exit handler
      }
    });

    // Unref the child process so parent can exit independently
    // But keep a reference to track it
    this.processes.set(pid, child);
    child.unref();

    // Wait a moment to see if the process stays alive
    // Use longer wait for stdio servers as they may take time to initialize
    const waitTime = isNetworkServer ? 1000 : 2000;
    await new Promise(resolve => setTimeout(resolve, waitTime));

    // Check if process is still running with retry logic
    // For stdio servers, they might appear to exit if no client connects
    // but they're actually waiting for connections
    const isAlive = await isProcessRunningWithRetry(pid, 3, 500);
    
    // Also check child process status for additional confirmation
    const childAlive = child.exitCode === null && child.signalCode === null;
    
    // Final determination: consider process alive if either check passes
    // This handles edge cases where detached processes lose the child reference
    const finalIsAlive = isAlive || childAlive;
    
    const processInfo: ProcessInfo = {
      pid: pid,
      serverName: serverNameOrUrl,
      name: manifest.name,
      version: manifest.version,
      manifest: {
        name: manifest.name,
        version: manifest.version,
        runtime: manifest.runtime
      },
      startTime: Date.now(),
      status: finalIsAlive ? 'running' : 'stopped',
      logPath: finalLogPath
    };

    // Store process information
    await this.store.addProcess(processInfo);

    if (finalIsAlive) {
      logger.info(`✓ Started ${manifest.name} v${manifest.version} (PID: ${pid})`);
      logger.info(`  Logs: ${finalLogPath}`);
      logger.info(`  Status: Running (detached process)`);
      
      // Try to discover tools dynamically if server supports it
      await this.discoverToolsIfSupported(serverNameOrUrl, manifest, child);
    } else {
      const exitCode = child.exitCode;
      const signalCode = child.signalCode;
      logger.info(`⚠️  Process ${pid} exited immediately`);
      logger.info(`  Exit code: ${exitCode !== null ? exitCode : 'N/A'}`);
      logger.info(`  Signal: ${signalCode || 'N/A'}`);
      logger.info(`  Check logs: ${finalLogPath}`);
      logger.info(`  Note: Some MCP servers may exit if they require stdio communication`);
      
      // If process exited immediately, update status in store
      await this.store.updateProcess(pid, { status: 'stopped' });
    }
    
    return pid;
  }

  /**
   * Discover tools from a running MCP server via MCP protocol's tools/list
   * This enables dynamic tool discovery even when mcp.json has no tools defined
   */
  private async discoverToolsIfSupported(
    serverName: string,
    manifest: any,
    childProcess: ChildProcess
  ): Promise<void> {
    try {
      // Check if manifest already has tools defined (static mode)
      const hasToolsInManifest = 
        (manifest.tools && manifest.tools.length > 0) ||
        (manifest.capabilities?.tools && manifest.capabilities.tools.length > 0);
      
      if (hasToolsInManifest) {
        logger.info(`ℹ️  Server has static tool definitions, skipping dynamic discovery`);
        return;
      }
      
      logger.info(`🔍 Attempting dynamic tool discovery for ${manifest.name}...`);
      
      // Create an MCPClient connected to the already-running child process
      // This avoids spawning a second process and communicates via the existing stdio
      const client = new MCPClient({
        transport: {
          type: 'stdio',
          command: manifest.runtime.command,
          args: manifest.runtime.args || [],
          existingProcess: childProcess
        },
        timeout: 15000,
        maxRetries: 2,
        serverName: manifest.name
      });
      
      // Listen for stderr from the MCP server (for debugging)
      client.on('stderr', (msg: string) => {
        logger.debug(`[${manifest.name}] ${msg}`);
      });
      
      try {
        await client.connect();
        
        // Call tools/list via MCP protocol
        const tools = await client.listTools();
        
        if (tools && tools.length > 0) {
          logger.info(`✓ Dynamically discovered ${tools.length} tools from ${manifest.name}`);
          
          // Register discovered tools to the ToolRegistry
          const toolRegistry = getToolRegistry();
          await toolRegistry.registerDynamicTools(serverName, tools);
          
          // Log discovered tools (first 3)
          for (const tool of tools.slice(0, 3)) {
            logger.info(`  - ${tool.name}: ${tool.description}`);
          }
          if (tools.length > 3) {
            logger.info(`  ... and ${tools.length - 3} more`);
          }
        } else {
          logger.info(`ℹ️  Server ${manifest.name} returned no tools`);
        }
        
        // Disconnect the client after discovery
        await client.disconnect();
      } catch (connectError: any) {
        logger.warn(`⚠️  Dynamic tool discovery failed for ${manifest.name}: ${connectError.message}`);
        logger.info(`   Tools can still be used via direct MCP protocol calls when needed`);
      }
      
    } catch (error: any) {
      logger.error(`⚠️  Tool discovery error for ${manifest.name}:`, error.message);
      // Don't throw - tool discovery failure shouldn't stop server startup
    }
  }

  async stop(pid: number): Promise<void> {
    const process = this.processes.get(pid);
    if (process) {
      process.kill('SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for process to exit
      
      if (process.exitCode === null) {
        process.kill('SIGKILL');
      }
      
      await this.store.updateProcess(pid, { status: 'stopped' });
      this.processes.delete(pid);
      logger.info(`✓ Stopped process ${pid}`);
    } else {
      // If process is not in memory, try to kill it using system command
      try {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        
        // Try SIGTERM first
        try {
          await execAsync(`kill ${pid}`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Check if process is still running
          try {
            await execAsync(`kill -0 ${pid} 2>/dev/null`);
            // If kill -0 succeeds, process is still running, use SIGKILL
            await execAsync(`kill -9 ${pid}`);
          } catch {
            // Process is already dead, good
          }
        } catch (error) {
          // kill command failed, maybe process doesn't exist
          logger.info(`Process ${pid} may not exist or already stopped`);
        }
        
        logger.info(`✓ Stopped process ${pid} using system kill command`);
      } catch (error) {
        logger.info(`⚠️ Could not kill process ${pid}: ${error}`);
      }
      
      // Update storage status
      await this.store.updateProcess(pid, { status: 'stopped' });
    }
  }

  async list(): Promise<ProcessInfo[]> {
    return this.store.listProcesses();
  }

  async listRunning(): Promise<ProcessInfo[]> {
    return this.store.listRunningProcesses();
  }

  async get(pid: number): Promise<ProcessInfo | undefined> {
    return this.store.getProcess(pid);
  }

  async getByServerName(serverName: string): Promise<ProcessInfo | undefined> {
    return this.store.getProcessByServerName(serverName);
  }

  /**
   * Get the actual ChildProcess handle for a PID if it's managed by this instance
   */
  getProcessHandle(pid: number): ChildProcess | undefined {
    return this.processes.get(pid);
  }

  /**
   * Get the actual ChildProcess handle for a server name if it's managed by this instance
   */
  async getProcessHandleByServerName(serverName: string): Promise<ChildProcess | undefined> {
    const info = await this.getByServerName(serverName);
    if (info && info.pid) {
      return this.processes.get(info.pid);
    }
    return undefined;
  }

  async isRunning(pid: number): Promise<boolean> {
    const process = this.processes.get(pid);
    if (process) {
      return process.exitCode === null;
    }
    
    const info = await this.store.getProcess(pid);
    return info?.status === 'running' || false;
  }

  async cleanup(): Promise<void> {
    // Clean up stopped process records
    await this.store.clearStoppedProcesses();
    
    // Clean up exited processes in memory
    for (const [pid, process] of this.processes.entries()) {
      if (process.exitCode !== null) {
        this.processes.delete(pid);
      }
    }
  }
}

// Singleton instance
let processManager: ProcessManager | null = null;

export function getProcessManager(): ProcessManager {
  if (!processManager) {
    processManager = new ProcessManager();
  }
  return processManager;
}