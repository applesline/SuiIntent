import { logger } from "../core/logger";
/**
 * MCP Client Core Class
 * Provides complete MCP protocol client functionality
 *
 * Simplified version without TransportFactory and CircuitBreaker dependencies.
 * Uses a simple stdio-based transport implementation.
 */

import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import {
  MCPClientConfig,
  JSONRPCRequest,
  JSONRPCResponse,
  Tool,
  ToolList,
  ToolResult,
  Resource,
  ResourceList,
  Prompt,
  PromptList,
  MCPEvent,
  MCPEventType,
  MCP_METHODS,
} from './types';
import { ParameterMapper } from './parameter-mapper';
import { ErrorBoundary, globalErrorBoundary } from '../kernel/error-boundary';

// ==================== Simple Stdio Transport ====================

class StdioTransport extends EventEmitter {
  private process: ChildProcess | null = null;
  private buffer: string = '';
  private _connected: boolean = false;
  private _existingProcess: ChildProcess | null = null;

  constructor(private config: { command: string; args?: string[]; env?: Record<string, string>; existingProcess?: ChildProcess }) {
    super();
    this._existingProcess = config.existingProcess || null;
  }

  async connect(): Promise<void> {
    if (this._connected) return;

    // Helper to setup listeners for a process
    const setupProcessListeners = (child: ChildProcess) => {
      child.stdout?.on('data', (data: Buffer) => {
        this.buffer += data.toString();
        this.processBuffer();
      });

      child.stderr?.on('data', (data: Buffer) => {
        // MCP servers often log to stderr, forward as debug
        const msg = data.toString().trim();
        if (msg) {
          this.emit('stderr', msg);
        }
      });

      child.on('error', (error: Error) => {
        this._connected = false;
        this.emit('error', error);
      });

      child.on('exit', (code: number | null) => {
        this._connected = false;
        this.emit('disconnected');
        if (code !== 0 && code !== null) {
          this.emit('error', new Error(`Process exited with code ${code}`));
        }
      });

      child.on('close', () => {
        this._connected = false;
        this.emit('disconnected');
      });
    };

    // If an existing process was provided, use it directly
    if (this._existingProcess) {
      this.process = this._existingProcess;
      setupProcessListeners(this.process);
      this._connected = true;
      this.emit('connected');
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        const child = spawn(this.config.command, this.config.args || [], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: this.config.env || process.env as Record<string, string>,
          shell: false,
        });

        this.process = child;
        setupProcessListeners(child);

        // Give the process a moment to start
        setTimeout(() => {
          if (child.exitCode === null) {
            this._connected = true;
            this.emit('connected');
            resolve();
          } else {
            reject(new Error(`Process exited immediately with code ${child.exitCode}`));
          }
        }, 500);
      } catch (error) {
        reject(error);
      }
    });
  }

  async disconnect(): Promise<void> {
    if (this.process) {
      // If this is an existing process (not spawned by us), don't kill it
      // Just detach from it
      if (this._existingProcess) {
        this.process = null;
        this._connected = false;
        return;
      }
      
      this.process.kill('SIGTERM');
      // Give it a moment to exit gracefully
      await new Promise(resolve => setTimeout(resolve, 500));
      if (this.process.exitCode === null) {
        this.process.kill('SIGKILL');
      }
      this.process = null;
    }
    this._connected = false;
  }

  isConnected(): boolean {
    return this._connected && this.process !== null && this.process.exitCode === null;
  }

  async send(message: any): Promise<void> {
    if (!this.process?.stdin) {
      throw new Error('Transport not connected');
    }

    const data = JSON.stringify(message) + '\n';
    this.process.stdin.write(data);
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    // Keep the last incomplete line in the buffer
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const message = JSON.parse(trimmed);
        this.emit('message', message);
      } catch (error) {
        // Non-JSON output from stderr-like messages
        this.emit('stderr', trimmed);
      }
    }
  }
}

// ==================== MCP Client ====================

export class MCPClient extends EventEmitter {
  private config: MCPClientConfig;
  private transport: StdioTransport;
  private connected: boolean = false;
  private requestId: number = 0;
  private pendingRequests: Map<string | number, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();

  // State
  private tools: Tool[] = [];
  private resources: Resource[] = [];
  private prompts: Prompt[] = [];
  private sessionId?: string;

  constructor(config: MCPClientConfig) {
    super();
    this.config = {
      autoConnect: false,
      timeout: 60000,
      maxRetries: 3,
      ...config,
    };

    this.transport = new StdioTransport({
      command: config.transport.command || 'npx',
      args: config.transport.args || [],
      env: config.transport.env as Record<string, string> | undefined,
      existingProcess: config.transport.existingProcess,
    });
    this.setupTransportListeners();
  }

  // ==================== Connection Management ====================

  async connect(): Promise<void> {
    if (this.connected) return;

    const result = await globalErrorBoundary.execute(
      async () => {
        await this.transport.connect();
        this.connected = true;
        this.emitEvent('connected');

        if (this.config.autoConnect) {
          await this.refreshTools();
        }

        // Health check
        try {
          const tools = await this.listTools();
          logger.debug(`[MCPClient] Health check passed: ${tools.length} tools available`);
        } catch (healthError: any) {
          logger.warn(`[MCPClient] Health check failed: ${healthError.message}`);
        }
      },
      {
        serverName: this.config.serverName,
        operationName: 'connect',
      },
    );

    if (!result.success) {
      this.emitEvent('error', result.error);
      throw result.error || new Error('Connection failed');
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;

    try {
      await this.transport.disconnect();
    } catch (error) {
      this.emitEvent('error', error);
      throw error;
    } finally {
      this.connected = false;
      this.pendingRequests.forEach(({ reject, timeout }) => {
        clearTimeout(timeout);
        reject(new Error('Disconnected'));
      });
      this.pendingRequests.clear();
      this.emitEvent('disconnected');
    }
  }

  isConnected(): boolean {
    return this.connected && this.transport.isConnected();
  }

  // ==================== Tool Related Methods ====================

  async listTools(): Promise<Tool[]> {
    const result = await globalErrorBoundary.execute(
      async () => {
        const response = await this.sendRequest(MCP_METHODS.TOOLS_LIST);
        const toolList = response as ToolList;
        this.tools = toolList.tools;
        this.emitEvent('tools_updated', this.tools);
        return this.tools;
      },
      {
        serverName: this.config.serverName,
        operationName: 'listTools',
      },
    );

    if (!result.success) {
      throw result.error || new Error('Failed to list tools');
    }

    return result.result!;
  }

  async callTool(toolName: string, arguments_: Record<string, any>): Promise<ToolResult> {
    const tool = this.findTool(toolName);
    let mappedArguments = arguments_;

    if (tool) {
      try {
        const { normalized } = ParameterMapper.validateAndNormalize(toolName, tool.inputSchema, arguments_);
        mappedArguments = normalized;
      } catch (error) {
        logger.warn(`Parameter mapping failed for tool "${toolName}":`, error instanceof Error ? error.message : String(error));
      }
    }

    // Clean up null values
    if (tool && tool.inputSchema && tool.inputSchema.properties) {
      for (const [paramName, paramValue] of Object.entries(mappedArguments)) {
        if (paramValue === null || paramValue === undefined) {
          const paramSchema = tool.inputSchema.properties[paramName];
          if (paramSchema) {
            if (paramSchema.default !== undefined) {
              mappedArguments[paramName] = paramSchema.default;
            } else {
              delete mappedArguments[paramName];
            }
          } else {
            delete mappedArguments[paramName];
          }
        }
      }
    }

    const result = await globalErrorBoundary.execute(
      async () => {
        let lastError: Error | null = null;
        const maxRetries = this.config.maxRetries || 3;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            const response = await this.sendRequest(MCP_METHODS.TOOLS_CALL, {
              name: toolName,
              arguments: mappedArguments,
            });

            if (response === undefined || response === null) {
              lastError = new Error(`Tool "${toolName}" execution failed: MCP server returned empty response`);
              if (attempt < maxRetries) {
                await this.delay(1000 * attempt);
                continue;
              }
              throw lastError;
            }

            const toolResult = response as ToolResult;

            if (typeof toolResult !== 'object' || toolResult === null) {
              lastError = new Error(`Tool "${toolName}" execution failed: invalid response format`);
              if (attempt < maxRetries) {
                await this.delay(1000 * attempt);
                continue;
              }
              throw lastError;
            }

            if (toolResult.isError) {
              const errorMessage = toolResult.content?.[0]?.text || 'Tool execution failed';
              if (this.isRetryableError(errorMessage) && attempt < maxRetries) {
                lastError = new Error(`Tool "${toolName}" execution failed: ${errorMessage}`);
                await this.delay(1000 * attempt);
                continue;
              }
              throw new Error(`Tool "${toolName}" execution failed: ${errorMessage}`);
            }

            return toolResult;
          } catch (error: any) {
            lastError = error;
            if (attempt < maxRetries) {
              await this.delay(1000 * attempt);
            }
          }
        }

        throw lastError || new Error(`Tool "${toolName}" execution failed after ${maxRetries} attempts`);
      },
      {
        serverName: this.config.serverName,
        toolName,
        operationName: `callTool:${toolName}`,
      },
    );

    if (!result.success) {
      throw result.error || new Error(`Tool "${toolName}" execution failed`);
    }

    return result.result!;
  }

  async refreshTools(): Promise<void> {
    await this.listTools();
  }

  getTools(): Tool[] {
    return [...this.tools];
  }

  findTool(name: string): Tool | undefined {
    return this.tools.find(tool => tool.name === name);
  }

  // ==================== Resource Related Methods ====================

  async listResources(): Promise<Resource[]> {
    const result = await globalErrorBoundary.execute(
      async () => {
        const response = await this.sendRequest(MCP_METHODS.RESOURCES_LIST);
        const resourceList = response as ResourceList;
        this.resources = resourceList.resources;
        this.emitEvent('resources_updated', this.resources);
        return this.resources;
      },
      {
        serverName: this.config.serverName,
        operationName: 'listResources',
      },
    );

    if (!result.success) {
      throw result.error || new Error('Failed to list resources');
    }

    return result.result!;
  }

  async readResource(uri: string): Promise<any> {
    const result = await globalErrorBoundary.execute(
      async () => {
        const response = await this.sendRequest(MCP_METHODS.RESOURCES_READ, { uri });
        return response;
      },
      {
        serverName: this.config.serverName,
        operationName: `readResource:${uri}`,
      },
    );

    if (!result.success) {
      throw result.error || new Error(`Failed to read resource: ${uri}`);
    }

    return result.result;
  }

  async refreshResources(): Promise<void> {
    await this.listResources();
  }

  getResources(): Resource[] {
    return [...this.resources];
  }

  // ==================== Prompt Related Methods ====================

  async listPrompts(): Promise<Prompt[]> {
    const result = await globalErrorBoundary.execute(
      async () => {
        const response = await this.sendRequest(MCP_METHODS.PROMPTS_LIST);
        const promptList = response as PromptList;
        this.prompts = promptList.prompts;
        this.emitEvent('prompts_updated', this.prompts);
        return this.prompts;
      },
      {
        serverName: this.config.serverName,
        operationName: 'listPrompts',
      },
    );

    if (!result.success) {
      throw result.error || new Error('Failed to list prompts');
    }

    return result.result!;
  }

  async getPrompt(name: string, arguments_?: Record<string, any>): Promise<any> {
    const result = await globalErrorBoundary.execute(
      async () => {
        const response = await this.sendRequest(MCP_METHODS.PROMPTS_GET, {
          name,
          arguments: arguments_,
        });
        return response;
      },
      {
        serverName: this.config.serverName,
        operationName: `getPrompt:${name}`,
      },
    );

    if (!result.success) {
      throw result.error || new Error(`Failed to get prompt: ${name}`);
    }

    return result.result;
  }

  async refreshPrompts(): Promise<void> {
    await this.listPrompts();
  }

  getPrompts(): Prompt[] {
    return [...this.prompts];
  }

  // ==================== Core Request Methods ====================

  private async sendRequest(method: string, params?: any): Promise<any> {
    if (!this.isConnected()) {
      throw new Error('Not connected to MCP server');
    }

    const requestId = this.generateRequestId();
    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id: requestId,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Request timeout after ${this.config.timeout}ms`));
      }, this.config.timeout);

      this.pendingRequests.set(requestId, { resolve, reject, timeout });

      this.transport.send(request).catch(error => {
        this.pendingRequests.delete(requestId);
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  private generateRequestId(): string {
    return `req_${++this.requestId}_${Date.now()}`;
  }

  // ==================== Transport Layer Event Handling ====================

  private setupTransportListeners(): void {
    this.transport.on('message', this.handleTransportMessage.bind(this));
    this.transport.on('error', this.handleTransportError.bind(this));
    this.transport.on('connected', () => {
      this.connected = true;
      this.emitEvent('connected');
    });
    this.transport.on('disconnected', () => {
      this.connected = false;
      this.emitEvent('disconnected');
    });
  }

  private handleTransportMessage(message: any): void {
    try {
      const response = message as JSONRPCResponse;

      if (!response || typeof response !== 'object') {
        logger.error('[MCPClient] Invalid response received:', message);
        return;
      }

      if (response.id && this.pendingRequests.has(response.id)) {
        const { resolve, reject, timeout } = this.pendingRequests.get(response.id)!;
        clearTimeout(timeout);
        this.pendingRequests.delete(response.id);

        if (response.error) {
          const errorMessage = response.error.message || 'Unknown error';
          const error = new Error(errorMessage);
          (error as any).code = response.error.code;
          (error as any).data = response.error.data;
          reject(error);
        } else {
          resolve(response.result !== undefined ? response.result : null);
        }
      } else if (!response.id) {
        this.handleNotification(response);
      }
    } catch (error) {
      this.emitEvent('error', error);
    }
  }

  private handleTransportError(error: Error): void {
    this.emitEvent('error', error);
  }

  private handleNotification(response: JSONRPCResponse): void {
    if (response.result) {
      logger.info('Received notification:', response);
    }
  }

  // ==================== Event Emission ====================

  private emitEvent(type: MCPEventType, data?: any): void {
    const event: MCPEvent = {
      type,
      data,
      timestamp: Date.now(),
    };
    this.emit(type, event);
    this.emit('event', event);
  }

  // ==================== Utility Methods ====================

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private isRetryableError(errorMessage: string): boolean {
    const retryablePatterns = [
      /timeout/i, /network/i, /connection/i, /temporarily/i,
      /busy/i, /rate limit/i, /too many requests/i, /server error/i, /internal error/i
    ];
    return retryablePatterns.some(pattern => pattern.test(errorMessage));
  }

  async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: Error;
    for (let attempt = 1; attempt <= this.config.maxRetries!; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        if (attempt < this.config.maxRetries!) {
          await new Promise(resolve => setTimeout(resolve, Math.min(1000 * Math.pow(2, attempt - 1), 10000)));
        }
      }
    }
    throw lastError!;
  }

  // ==================== Status Query ====================

  getStatus() {
    return {
      connected: this.connected,
      toolsCount: this.tools.length,
      resourcesCount: this.resources.length,
      promptsCount: this.prompts.length,
      sessionId: this.sessionId,
    };
  }

  // ==================== Cleanup ====================

  destroy(): void {
    this.disconnect().catch(() => {});
    this.removeAllListeners();
    this.pendingRequests.clear();
    this.tools = [];
    this.resources = [];
    this.prompts = [];
  }
}
