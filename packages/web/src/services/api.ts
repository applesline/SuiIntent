import axios from 'axios';
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import type {
  MCPServer,
  ProcessInfo,
  Config,
  Secret,
  Workflow,
  SystemStats,
  PullServerRequest,
  StartServerRequest,
  StopProcessRequest,
  UpdateConfigRequest,
  CreateSecretRequest,
  ExecuteWorkflowRequest,
  Notification,
  NotificationStats,
} from '../types';

import type { 
  UnifiedExecutionOptions, 
  UnifiedExecutionResult 
} from '@intentorch/core';

import { API_BASE_URL } from './config';

class ApiService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: 60000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Request interceptor
    this.client.interceptors.request.use(
      async (config: InternalAxiosRequestConfig) => {
        // 1. Prioritize token from URL (one-time injection from CLI)
        const urlParams = new URLSearchParams(window.location.search);
        const urlToken = urlParams.get('token');
        if (urlToken) {
          localStorage.setItem('auth_token', urlToken);
          // Clean up URL to avoid leakage in history
          window.history.replaceState({}, document.title, window.location.pathname);
        }

        // 2. Add authentication token if available
        let token = localStorage.getItem('auth_token');
        
        // 3. If no token, try to get one from daemon automatically
        if (!token && config.url !== '/api/auth/token' && config.url !== '/api/status') {
          try {
            const tokenResponse = await axios.get(`${API_BASE_URL}/api/auth/token`, {
              timeout: 3000
            });
            
            if (tokenResponse.data && tokenResponse.data.token) {
              token = tokenResponse.data.token;
              if (token) {
                localStorage.setItem('auth_token', token);
              }
            }
          } catch (error) {
            console.warn('[ApiService] Failed to get auth token from daemon:', error);
          }
        }

        if (token && config.headers) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor - flattening the Daemon response
    this.client.interceptors.response.use(
      (response) => response.data,
      (error) => {
        if (error.response?.status === 401) {
          localStorage.removeItem('auth_token');
        }
        const errorMessage = error.response?.data?.error || error.response?.data?.message || error.message;
        console.error('API Error:', errorMessage);
        return Promise.reject(new Error(errorMessage));
      }
    );
  }

  // Server management
  async getServers(): Promise<MCPServer[]> {
    const response = await this.client.get('/api/servers') as any;
    const servers = response.servers || [];
    
    return servers.map((server: any) => {
      const manifest = server.manifest || {};
      const serverName = manifest.name || server.name || server.serverName || 'unknown';
      const version = manifest.version || server.version || 'unknown';
      const description = manifest.description || server.description || '';
      const runtime = manifest.runtime || server.runtime || {
        type: 'unknown',
        command: '',
        args: [],
        env: []
      };
      
      return {
        id: server.pid?.toString() || server.id || '0',
        name: serverName,
        version: version,
        description: description,
        runtime: runtime,
        capabilities: manifest.capabilities || server.capabilities || {},
        status: server.status || 'stopped',
        lastStartedAt: server.startTime ? new Date(server.startTime).toISOString() : undefined
      };
    });
  }

  async getServer(id: string): Promise<MCPServer> {
    const response = await this.client.get(`/api/servers/${id}`) as any;
    const server = response.server || response;
    
    return {
      id: server.pid?.toString() || server.id || id,
      name: server.manifest?.name || server.name || server.serverName,
      version: server.manifest?.version || server.version,
      description: server.manifest?.description || server.description,
      runtime: server.manifest?.runtime || server.runtime,
      capabilities: server.manifest?.capabilities || server.capabilities,
      status: server.status,
      lastStartedAt: server.startTime ? new Date(server.startTime).toISOString() : undefined
    };
  }

  async pullServer(request: PullServerRequest): Promise<MCPServer> {
    const backendRequest = { serverNameOrUrl: request.serverName };
    const response = await this.client.post('/api/servers/pull', backendRequest) as any;
    
    const server = response.server || response;
    const result: MCPServer = {
      id: server.pid?.toString() || '0',
      name: server.manifest?.name || server.name || server.serverName,
      version: server.manifest?.version || server.version || 'unknown',
      description: server.manifest?.description || server.description || '',
      runtime: server.manifest?.runtime || server.runtime || { type: 'unknown', command: '', args: [], env: [] },
      capabilities: server.manifest?.capabilities || server.capabilities || {},
      status: server.status || 'pulled',
      lastStartedAt: server.startTime ? new Date(server.startTime).toISOString() : undefined
    };

    return result;
  }

  /**
   * Import MCP config (Claude Desktop format)
   */
  async importConfig(config: string): Promise<{ success: boolean; message: string; imported: any[]; total: number }> {
    return await this.client.post('/api/servers/import', { config }) as any;
  }

  async startServer(request: StartServerRequest): Promise<ProcessInfo> {
    const response = await this.client.post(`/api/servers`, { serverNameOrUrl: request.serverId }) as any;
    return {
      pid: response.pid,
      serverName: response.name,
      name: response.name,
      version: response.version,
      status: response.status,
      logPath: response.logPath,
      startTime: Date.now(),
      manifest: {
        name: response.name,
        version: response.version,
        runtime: { type: "unknown", command: "" }
      }
    } as any;
  }

  async deleteServer(id: string): Promise<void> {
    await this.client.delete(`/api/servers/${id}`);
  }

  // Execution & AI
  async parseIntent(intent: string, context?: any): Promise<UnifiedExecutionResult> {
    const response = await this.client.post('/api/execute/parse-intent', { intent, context }) as any;
    return response.data || response;
  }

  async executeNaturalLanguage(query: string, options?: UnifiedExecutionOptions): Promise<UnifiedExecutionResult> {
    return await this.client.post('/api/execute/natural-language', { query, options }) as any;
  }

  async executeSteps(request: { steps: any[]; options?: UnifiedExecutionOptions }): Promise<UnifiedExecutionResult> {
    const response = await this.client.post('/api/execute/steps', request) as any;
    return response.data || response;
  }

  // Process management
  async getProcesses(): Promise<ProcessInfo[]> {
    const response = await this.client.get('/api/servers') as any;
    const servers = (response.servers || []) as any[];
    return servers.map(server => ({
      ...server,
      serverId: server.pid?.toString() || '0',
      serverName: server.name || server.serverName,
      status: server.status || 'running',
      startedAt: server.startTime ? new Date(server.startTime).toISOString() : new Date().toISOString()
    }));
  }

  async stopProcess(request: StopProcessRequest): Promise<void> {
    await this.client.delete(`/api/servers/${request.pid}`);
  }

  async getProcessLogs(pid: number): Promise<string> {
    const response = await this.client.get(`/api/servers/${pid}/logs`) as any;
    return response.logs || '';
  }

  // Configuration management
  async getConfig(): Promise<Config> {
    const response = await this.client.get('/api/config') as any;
    return response.config;
  }

  async updateConfig(request: UpdateConfigRequest): Promise<Config> {
    const response = await this.client.put('/api/config', request) as any;
    return response.config;
  }

  // Secrets management
  async getSecrets(): Promise<Secret[]> {
    const response = await this.client.get('/api/secrets') as any;
    return response.secrets || [];
  }

  async createSecret(request: CreateSecretRequest): Promise<Secret> {
    const response = await this.client.post('/api/secrets', request) as any;
    return response.secret;
  }

  async deleteSecret(name: string): Promise<void> {
    await this.client.delete(`/api/secrets/${name}`);
  }

  // Workflow management
  async getWorkflows(): Promise<Workflow[]> {
    const response = await this.client.get('/api/workflows') as any;
    return response.workflows || [];
  }

  async getWorkflow(id: string): Promise<Workflow> {
    const encodedId = encodeURIComponent(id);
    const response = await this.client.get(`/api/workflows/${encodedId}`) as any;
    return response.workflow;
  }

  async saveWorkflow(workflow: Workflow): Promise<Workflow> {
    const response = await this.client.post('/api/workflows', workflow) as any;
    return response.workflow || response;
  }

  async deleteWorkflow(id: string): Promise<void> {
    const encodedId = encodeURIComponent(id);
    await this.client.delete(`/api/workflows/${encodedId}`);
  }

  async executeWorkflow(request: ExecuteWorkflowRequest): Promise<any> {
    const encodedId = encodeURIComponent(request.workflowId);
    return await this.client.post(`/api/workflows/${encodedId}/execute`, request.parameters || {}) as any;
  }

  // System information
  async getSystemStats(): Promise<SystemStats> {
    const response = await this.client.get('/api/system/stats') as any;
    return response.stats;
  }

  async getSystemLogs(): Promise<string> {
    const response = await this.client.get('/api/system/logs') as any;
    return response.logs || '';
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get('/api/status') as any;
      return !!response.running;
    } catch {
      return false;
    }
  }

  async verifyToken(): Promise<boolean> {
    try {
      await this.client.get('/api/auth/verify');
      return true;
    } catch {
      return false;
    }
  }

  async testAIConfig(config: { provider: string; model: string; apiKey: string }): Promise<{ success: boolean; message?: string }> {
    try {
      const response = await this.client.post('/api/ai/test', config) as any;
      return { success: true, message: response.message || 'Configuration test successful' };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Configuration test failed'
      };
    }
  }

  // Notification management
  async getNotifications(): Promise<Notification[]> {
    try {
      const response = await this.client.get('/api/notifications') as any;
      return response.notifications || [];
    } catch {
      return [];
    }
  }

  async markNotificationAsRead(id: string): Promise<void> {
    await this.client.post(`/api/notifications/${id}/read`);
  }

  // Search logic (Kept for compatibility, but simplified)
  async searchServices(query: string, source?: string, limit?: number, offset?: number) {
    const params: any = { q: query, source, limit, offset };
    try {
      return await this.client.get('/api/servers/search', { params }) as any;
    } catch {
      return { services: [], total: 0, source: source || 'unknown', hasMore: false };
    }
  }
}

export const apiService = new ApiService();
