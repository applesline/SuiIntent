import http from 'http';
import { getDaemonPidPath } from '../utils/paths';
import fs from 'fs/promises';
import { getSecretManager } from '../secret/manager';
import {
  DaemonStatusResponse,
  StartServerRequest,
  StartServerResponse,
  StopServerResponse,
  ListServersResponse,
  ServerLogsResponse,
  ErrorResponse,
} from './types';

export class DaemonClient {
  private baseUrl: string;

  constructor(host: string = 'localhost', port: number = 9658) {
    this.baseUrl = `http://${host}:${port}`;
  }

  private async request<T>(method: string, path: string, data?: any): Promise<T> {
    // Get authentication token for daemon requests
    const secretManager = getSecretManager();
    const token = await secretManager.get('daemon_auth_token');

    return new Promise((resolve, reject) => {
      try {
        const url = `${this.baseUrl}${path}`;
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Local-Pid': process.pid.toString(),
        };

        // Add Authorization header if token is a valid non-empty string and path is not /api/status
        if (token && typeof token === 'string' && token.trim() !== '' && path !== '/api/status') {
          headers['Authorization'] = `Bearer ${token.trim()}`;
        }

        const options: http.RequestOptions = {
          method,
          headers,
          agent: false, // Disable proxy and connection pooling for local reliability
        };

        const req = http.request(url, options, (res) => {
          let responseData = '';
          
          res.on('data', (chunk) => {
            responseData += chunk;
          });
          
          res.on('end', () => {
            try {
              const parsed = JSON.parse(responseData);
              if (res.statusCode && res.statusCode >= 400) {
                const error = parsed as ErrorResponse;
                const errorMsg = error.message ? `${error.error}: ${error.message}` : `${error.error}`;
                reject(new Error(errorMsg));
              } else {
                resolve(parsed as T);
              }
            } catch (_error) {
              reject(new Error(`Failed to parse response: ${responseData}`));
            }
          });
        });

        req.on('error', (error) => {
          reject(new Error(`Request failed: ${error.message}`));
        });

        if (data) {
          req.write(JSON.stringify(data));
        }
        
        req.end();
      } catch (error) {
        reject(new Error(`Failed to prepare request: ${(error as Error).message}`));
      }
    });
  }

  async getStatus(): Promise<DaemonStatusResponse> {
    return this.request<DaemonStatusResponse>('GET', '/api/status');
  }

  async startServer(serverNameOrUrl: string): Promise<StartServerResponse> {
    const request: StartServerRequest = { serverNameOrUrl };
    return this.request<StartServerResponse>('POST', '/api/servers', request);
  }

  async stopServer(pid: number): Promise<StopServerResponse> {
    return this.request<StopServerResponse>('DELETE', `/api/servers/${pid}`);
  }

  async listServers(): Promise<ListServersResponse> {
    return this.request<ListServersResponse>('GET', '/api/servers');
  }

  async getServerStatus(pid: number): Promise<any> {
    return this.request<any>('GET', `/api/servers/${pid}`);
  }

  async getServerLogs(pid: number): Promise<ServerLogsResponse> {
    return this.request<ServerLogsResponse>('GET', `/api/servers/${pid}/logs`);
  }

  /**
   * Execute natural language query via daemon
   */
  async executeNaturalLanguage(query: string, options?: any): Promise<any> {
    return this.request<any>('POST', '/api/execute/natural-language', { query, options });
  }

  /**
   * Parse intent via daemon
   */
  async parseIntent(intent: string, context?: any): Promise<any> {
    return this.request<any>('POST', '/api/execute/parse-intent', { intent, context });
  }

  /**
   * Execute pre-parsed steps via daemon
   */
  async executeSteps(steps: any[], options?: any): Promise<any> {
    return this.request<any>('POST', '/api/execute/steps', { steps, options });
  }

  async isDaemonRunning(): Promise<boolean> {
    try {
      await this.getStatus();
      return true;
    } catch (_error) {
      return false;
    }
  }

  static async getDaemonPid(): Promise<number | null> {
    try {
      const pidFile = getDaemonPidPath();
      const pidStr = await fs.readFile(pidFile, 'utf-8');
      const pid = parseInt(pidStr.trim(), 10);
      return isNaN(pid) ? null : pid;
    } catch (_error) {
      return null;
    }
  }

  static async isDaemonProcessRunning(): Promise<boolean> {
    const pid = await this.getDaemonPid();
    if (!pid) return false;

    try {
      // Try to send signal 0 to check if process exists
      process.kill(pid, 0);
      return true;
    } catch (_error) {
      return false;
    }
  }
}