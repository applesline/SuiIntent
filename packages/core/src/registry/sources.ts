import { logger } from "../core/logger";
import axios from 'axios';
import { Manifest, RegistrySource, SearchOptions, SearchResult, ServiceInfo } from './types';
import { PROGRAM_NAME } from '../utils/constants';

/**
 * Infer runtime type from command
 */
function inferRuntimeType(command: string): string {
  const cmd = command.toLowerCase().trim();
  if (cmd.includes('node') || cmd.includes('bun')) return 'nodejs';
  if (cmd.includes('python') || cmd.includes('python3')) return 'python';
  if (cmd.includes('go') || cmd.includes('golang')) return 'go';
  if (cmd.includes('java') || cmd.includes('javac')) return 'java';
  if (cmd.includes('rust') || cmd.includes('cargo')) return 'rust';
  if (cmd.includes('docker') || cmd.includes('podman')) return 'docker';
  return 'process';
}

/**
 * Check if the given JSON data is a Claude Desktop format (has mcpServers field)
 */
function isClaudeDesktopConfig(data: any): boolean {
  return data && typeof data === 'object' && 'mcpServers' in data;
}

/**
 * Convert a single Claude Desktop server entry to an IntentOrch Manifest
 */
function claudeDesktopEntryToManifest(serverName: string, entry: any): Manifest {
  const manifest: Manifest = {
    name: serverName,
    version: '1.0.0',
    description: `Imported from MCP config: ${serverName}`,
    runtime: {
      type: inferRuntimeType(entry.command || ''),
      command: entry.command || '',
      args: entry.args || [],
      env: entry.env ? Object.keys(entry.env) : [],
    },
    transport: {
      type: 'stdio',
    },
  };
  return manifest;
}

/**
 * Parse a Claude Desktop config and return an array of Manifests
 */
export function parseClaudeDesktopConfig(configJson: string): Manifest[] {
  const data = JSON.parse(configJson);
  
  if (!isClaudeDesktopConfig(data)) {
    throw new Error('Not a valid Claude Desktop config format: missing "mcpServers" field');
  }
  
  const manifests: Manifest[] = [];
  const servers = data.mcpServers;
  
  for (const [serverName, entry] of Object.entries(servers)) {
    const entryObj = entry as any;
    if (!entryObj.command) {
      logger.warn(`Skipping server "${serverName}": missing "command" field`);
      continue;
    }
    manifests.push(claudeDesktopEntryToManifest(serverName, entryObj));
  }
  
  if (manifests.length === 0) {
    throw new Error('No valid MCP server entries found in the config');
  }
  
  return manifests;
}

export class GitHubRegistrySource implements RegistrySource {
  name = 'github';

  async fetchManifest(serverName: string): Promise<Manifest> {
    // Support multiple GitHub URL formats:
    // 1. Direct GitHub repository: owner/repo (e.g., someuser/some-repo)
    // 2. With branch: owner/repo@branch (e.g., someuser/some-repo@main)
    // 3. With custom path: owner/repo:path/to/mcp.json (e.g., someuser/some-repo:dist/mcp.json)
    // 4. Combined: owner/repo@branch:path (e.g., someuser/some-repo@main:dist/mcp.json)
    // 5. Central hub path: path/to/module (e.g., github/github-mcp-server) - from central hub
    
    // First, check if it's a direct GitHub repository
    // Criteria: contains @ or : (explicit GitHub syntax), OR is in owner/repo format (exactly one slash, no dots)
    const hasGitHubSyntax = serverName.includes('@') || serverName.includes(':') ||
      (serverName.match(/\//g)?.length === 1 && !serverName.includes('.') && !serverName.includes('\\'));
    
    if (hasGitHubSyntax) {
      // Parse as direct GitHub repository
      const { owner, repo, branch, filePath } = this.parseGitHubIdentifier(serverName);
      
      // Try different branch names if not specified
      const branchesToTry = branch ? [branch] : ['main', 'master'];
      
      let lastError: any = null;
      
      for (const tryBranch of branchesToTry) {
        try {
          const url = `https://raw.githubusercontent.com/${owner}/${repo}/${tryBranch}/${filePath}`;
          logger.info(`Trying GitHub URL: ${url}`);
          const response = await axios.get(url, { timeout: 10000 });
          return response.data;
        } catch (error: any) {
          lastError = error;
          if (error.response?.status === 404) {
            // Continue to try next branch
            continue;
          }
          // For other errors, throw immediately
          throw this.createGitHubError(serverName, error);
        }
      }
      
      // If we tried all branches and still got 404
      if (lastError?.response?.status === 404) {
        throw new Error(
          `MCP Server "${serverName}" not found on GitHub.\n` +
          `Tried branches: ${branchesToTry.join(', ')}\n` +
          `File path: ${filePath}\n\n` +
          `Possible reasons:\n` +
          `1. Repository does not exist: https://github.com/${owner}/${repo}\n` +
          `2. Repository does not contain ${filePath} file\n` +
          `3. Repository may be private (requires authentication)\n` +
          `4. Branch name may be different (try specifying branch: ${owner}/${repo}@<branch-name>)\n\n` +
          `Solutions:\n` +
          `1. Check repository URL: https://github.com/${owner}/${repo}\n` +
          `2. Verify mcp.json file exists in the repository\n` +
          `3. Try specifying branch: ${PROGRAM_NAME} pull ${owner}/${repo}@<branch-name>\n` +
          `4. Try specifying custom path: ${PROGRAM_NAME} pull ${owner}/${repo}:<path/to/mcp.json>`
        );
      }
      
      throw this.createGitHubError(serverName, lastError);
    } else {
      // Treat as central hub path (e.g., github/github-mcp-server)
      return this.fetchFromCentralHub(serverName);
    }
  }

  private parseGitHubIdentifier(identifier: string): {
    owner: string;
    repo: string;
    branch?: string;
    filePath: string;
  } {
    // Default values
    let owner = '';
    let repo = '';
    let branch: string | undefined;
    let filePath = 'mcp.json';
    
    // Parse the identifier
    // Format: owner/repo[@branch][:filePath]
    
    // First, split by : to get file path if present
    const pathParts = identifier.split(':');
    if (pathParts.length > 1) {
      filePath = pathParts.slice(1).join(':');
      identifier = pathParts[0];
    }
    
    // Then, split by @ to get branch if present
    const branchParts = identifier.split('@');
    if (branchParts.length > 1) {
      branch = branchParts[1];
      identifier = branchParts[0];
    }
    
    // Finally, split by / to get owner and repo
    const repoParts = identifier.split('/');
    if (repoParts.length !== 2) {
      throw new Error(
        `Invalid GitHub repository identifier: ${identifier}\n` +
        `Expected format: owner/repo[@branch][:filePath]\n` +
        `Examples:\n` +
        `  - github/github-mcp-server\n` +
        `  - github/github-mcp-server@main\n` +
        `  - github/github-mcp-server:dist/mcp.json\n` +
        `  - github/github-mcp-server@main:dist/mcp.json`
      );
    }
    
    owner = repoParts[0];
    repo = repoParts[1];
    
    return { owner, repo, branch, filePath };
  }


  private async fetchFromCentralHub(moduleName: string): Promise<Manifest> {
    // Central hub configuration
    const hubOwner = process.env.GITHUB_HUB_OWNER || 'MCPilotX';
    const hubRepo = process.env.GITHUB_HUB_REPO || 'mcp-server-hub';
    const hubBranch = process.env.GITHUB_HUB_BRANCH || 'main';
    
    // Module path in hub
    const modulePath = `${moduleName}/mcp.json`;
    const url = `https://raw.githubusercontent.com/${hubOwner}/${hubRepo}/${hubBranch}/${modulePath}`;
    
    logger.info(`Trying GitHub Hub URL: ${url}`);
    
    try {
      const response = await axios.get(url, { timeout: 10000 });
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        throw new Error(
          `MCP Server "${moduleName}" not found in GitHub Hub.\n` +
          `Hub: ${hubOwner}/${hubRepo} (branch: ${hubBranch})\n` +
          `Path: ${modulePath}\n\n` +
          `Possible reasons:\n` +
          `1. Module does not exist in the hub\n` +
          `2. Module may have a different name\n` +
          `3. Hub configuration may be incorrect\n\n` +
          `Solutions:\n` +
          `1. Check available modules in hub: https://github.com/${hubOwner}/${hubRepo}\n` +
          `2. Configure custom hub: export GITHUB_HUB_OWNER=<owner> GITHUB_HUB_REPO=<repo>\n` +
          `3. Try direct GitHub repository: ${PROGRAM_NAME} pull <owner>/<repo>`
        );
      }
      throw this.createGitHubError(`hub:${moduleName}`, error);
    }
  }

  async searchServices(options: SearchOptions): Promise<SearchResult> {
    const { query = '', limit = 20, offset = 0 } = options;
    
    try {
      // Get available services from GitHub hub
      const hubOwner = process.env.GITHUB_HUB_OWNER || 'MCPilotX';
      const hubRepo = process.env.GITHUB_HUB_REPO || 'mcp-server-hub';
      const hubBranch = process.env.GITHUB_HUB_BRANCH || 'main';
      
      const url = `https://api.github.com/repos/${hubOwner}/${hubRepo}/contents/`;
      
      let allServices: ServiceInfo[] = [];
      
      try {
        const response = await axios.get(url, { 
          timeout: 10000,
          headers: {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'MCPilotX-OrchApp'
          }
        });
        
        const contents = response.data;
        
        // Filter directories (each directory is a potential service)
        const serviceDirs = contents.filter((item: any) => item.type === 'dir');
        
        allServices = await Promise.all(
          serviceDirs.map(async (dir: any) => {
            try {
              // Try to get mcp.json from the directory
              const manifestUrl = `https://raw.githubusercontent.com/${hubOwner}/${hubRepo}/${hubBranch}/${dir.name}/mcp.json`;
              const manifestResponse = await axios.get(manifestUrl, { timeout: 5000 });
              const manifest = manifestResponse.data;
              
              return {
                name: dir.name,
                description: manifest.description || `GitHub MCP service: ${dir.name}`,
                version: manifest.version || '1.0.0',
                source: 'github',
                tags: manifest.tags || ['github', 'mcp'],
                lastUpdated: dir.git_timestamp || new Date().toISOString().split('T')[0]
              };
            } catch (error) {
              // If mcp.json not found, return basic info
              return {
                name: dir.name,
                description: `GitHub MCP service: ${dir.name}`,
                version: '1.0.0',
                source: 'github',
                tags: ['github', 'mcp'],
                lastUpdated: new Date().toISOString().split('T')[0]
              };
            }
          })
        );
      } catch (error) {
        logger.warn('Failed to fetch from GitHub hub, using fallback list:', error);
        // Fallback to static list if hub is not accessible
        allServices = [
          {
            name: 'github/github-mcp-server',
            description: 'GitHub API integration service',
            version: '1.0.0',
            source: 'github',
            tags: ['github', 'code', 'repositories', 'git'],
            lastUpdated: '2024-01-08'
          }
        ];
      }

      // Filter services based on query
      const filteredServices = allServices.filter(service => {
        if (!query.trim()) return true;
        
        const searchText = query.toLowerCase();
        return (
          service.name.toLowerCase().includes(searchText) ||
          (service.description && service.description.toLowerCase().includes(searchText)) ||
          (service.tags && service.tags.some(tag => tag.toLowerCase().includes(searchText)))
        );
      });

      // Apply pagination
      const paginatedServices = filteredServices.slice(offset, offset + limit);

      return {
        services: paginatedServices,
        total: filteredServices.length,
        source: this.name,
        hasMore: offset + limit < filteredServices.length
      };
    } catch (error) {
      logger.error('Error searching GitHub registry:', error);
      // Return empty result on error
      return {
        services: [],
        total: 0,
        source: this.name,
        hasMore: false
      };
    }
  }

  async listAvailableServices(): Promise<ServiceInfo[]> {
    const result = await this.searchServices({});
    return result.services;
  }

  private createGitHubError(serverName: string, error: any): Error {
    if (error.response) {
      switch (error.response.status) {
        case 401:
        case 403:
          return new Error(
            `GitHub authentication required for ${serverName} (HTTP ${error.response.status}).\n` +
            `Possible reasons:\n` +
            `1. Repository is private\n` +
            `2. GitHub API rate limit exceeded\n\n` +
            `Solutions:\n` +
            `1. Use GitHub Personal Access Token: ${PROGRAM_NAME} secret set GITHUB_TOKEN <your-token>\n` +
            `2. Wait for rate limit reset\n` +
            `3. Use public repository or different source`
          );
        case 404:
          // Already handled in fetchManifest
          return new Error(`GitHub repository not found: ${serverName}`);
        case 429:
          return new Error(
            `GitHub API rate limit exceeded for ${serverName}.\n` +
            `Please wait before trying again or use GitHub Personal Access Token:\n` +
            `${PROGRAM_NAME} secret set GITHUB_TOKEN <your-token>`
          );
        default:
          const errorMsg = error.response.data?.message || error.message;
          return new Error(
            `GitHub API error: ${errorMsg}\n` +
            `Status: ${error.response?.status || 'N/A'}\n\n` +
            `Suggestions:\n` +
            `1. Check network connection\n` +
            `2. Verify repository exists: https://github.com/${serverName.split(':')[0]}\n` +
            `3. Try other registry source`
          );
      }
    } else if (error.request) {
      return new Error(
        `Cannot connect to GitHub (${serverName}). Possible reasons:\n` +
        `1. Network connection issue\n` +
        `2. GitHub service may be temporarily unavailable\n\n` +
        `Solutions:\n` +
        `1. Check your internet connection\n` +
        `2. Try again later`
      );
    } else {
      return new Error(`Error fetching from GitHub: ${error.message}`);
    }
  }
}


export class GiteeRegistrySource implements RegistrySource {
  name = 'gitee';

  async fetchManifest(serverName: string): Promise<Manifest> {
    // For demo purposes, return mock manifests for known services
    // In production, this would fetch from actual Gitee registry
    
    const mockManifests: Record<string, any> = {
      '12306': {
        name: '12306',
        version: '1.0.0',
        description: '12306 train ticket query service',
        runtime: {
          type: 'process',
          command: 'node',
          args: ['index.js']
        },
        transport: {
          type: 'stdio'
        },
        tools: [
          {
            name: 'query_tickets',
            description: 'Query train tickets',
            inputSchema: {
              type: 'object',
              properties: {
                from: { type: 'string', description: 'Departure station' },
                to: { type: 'string', description: 'Arrival station' },
                date: { type: 'string', description: 'Date (YYYY-MM-DD)' }
              },
              required: ['from', 'to', 'date']
            }
          }
        ]
      },
      'weather': {
        name: 'weather',
        version: '1.0.0',
        description: 'Weather query service',
        runtime: {
          type: 'process',
          command: 'node',
          args: ['index.js']
        },
        transport: {
          type: 'stdio'
        },
        tools: [
          {
            name: 'get_weather',
            description: 'Get weather information',
            inputSchema: {
              type: 'object',
              properties: {
                city: { type: 'string', description: 'City name' },
                days: { type: 'number', description: 'Forecast days', default: 3 }
              },
              required: ['city']
            }
          }
        ]
      },
      'news': {
        name: 'news',
        version: '1.0.0',
        description: 'News aggregation service',
        runtime: {
          type: 'process',
          command: 'node',
          args: ['index.js']
        },
        transport: {
          type: 'stdio'
        },
        tools: [
          {
            name: 'get_news',
            description: 'Get news',
            inputSchema: {
              type: 'object',
              properties: {
                category: { type: 'string', description: 'News category', default: 'general' },
                limit: { type: 'number', description: 'Return count', default: 10 }
              }
            }
          }
        ]
      },
      'github': {
        name: 'github',
        version: '1.0.0',
        description: 'GitHub API integration service',
        runtime: {
          type: 'process',
          command: 'node',
          args: ['index.js']
        },
        transport: {
          type: 'stdio'
        },
        tools: [
          {
            name: 'search_repositories',
            description: 'Search GitHub repositories',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'Search query' },
                language: { type: 'string', description: 'Programming language' }
              },
              required: ['query']
            }
          }
        ]
      }
    };

    // Check if we have a mock manifest for this server
    if (mockManifests[serverName]) {
      return mockManifests[serverName];
    }

    // If not found in mock data, try to fetch from actual Gitee registry
    // Gitee static registry format
    // Base URL: https://gitee.com/mcpilotx/mcp-server-hub/raw/master/
    // Format: {serverName}/mcp.json
    const baseUrl = 'https://gitee.com/mcpilotx/mcp-server-hub/raw/master/';
    const url = `${baseUrl}${serverName}/mcp.json`;
    
    try {
      const response = await axios.get(url);
      const data = response.data;
      
      // Handle tools in capabilities field (MCP standard format)
      // Convert to ExtendedManifest format with tools at root level
      if (data.capabilities?.tools) {
        // Create a new manifest with tools at root level for compatibility
        const manifest: any = {
          name: data.name,
          version: data.version,
          description: data.description,
          runtime: data.runtime,
          transport: data.transport
        };
        
        // Move tools from capabilities to root level
        manifest.tools = data.capabilities.tools;
        
        // Keep capabilities if needed
        if (data.capabilities) {
          manifest.capabilities = data.capabilities;
        }
        
        return manifest;
      }
      
      // If tools already at root level, return as-is
      if (data.tools) {
        return data;
      }
      
      // Return original data if no tools found
      return data;
      
    } catch (error: any) {
      if (error.response) {
        switch (error.response.status) {
          case 404:
            throw new Error(
              `MCP Server "${serverName}" not found in Gitee Registry (URL: ${url})\n` +
              `Possible reasons:\n` +
              `1. Server name is incorrect\n` +
              `2. The service may not be published to Gitee Registry\n` +
              `3. Service may have been deleted or moved\n\n` +
              `Solutions:\n` +
              `1. Check available servers in Gitee Registry: ${baseUrl}\n` +
              `2. Use other registry source\n` +
              `3. Use service URL directly (if known)`
            );
          default:
            const errorMsg = error.response.data?.message || error.message;
            throw new Error(
              `Gitee Registry API error: ${errorMsg}\n` +
              `URL: ${url}\n` +
              `Status: ${error.response?.status || 'N/A'}\n\n` +
              `Suggestions:\n` +
              `1. Check network connection\n` +
              `2. Try other registry source\n` +
              `3. Check if Gitee service is available`
            );
        }
      } else if (error.request) {
        throw new Error(
          `Cannot connect to Gitee Registry (URL: ${url}). Possible reasons:\n` +
          `1. Network connection issue\n` +
          `2. Gitee service may be temporarily unavailable\n\n` +
          `Solutions:\n` +
          `1. Check your internet connection\n` +
          `2. Try other registry source\n` +
          `3. Use URL directly`
        );
      } else {
        throw new Error(`Error fetching from Gitee Registry: ${error.message}`);
      }
    }
  }

  async searchServices(options: SearchOptions): Promise<SearchResult> {
    const { query = '', limit = 20, offset = 0 } = options;
    
    try {
      // Get available services from Gitee hub
      const hubOwner = 'mcpilotx';
      const hubRepo = 'mcp-server-hub';
      const hubBranch = 'master';
      
      const url = `https://gitee.com/api/v5/repos/${hubOwner}/${hubRepo}/contents/`;
      
      let allServices: ServiceInfo[] = [];
      
      try {
        const response = await axios.get(url, { 
          timeout: 10000,
          headers: {
            'User-Agent': 'MCPilotX-OrchApp'
          }
        });
        
        const contents = response.data;
        
        // Filter directories (each directory is a potential service category)
        const categoryDirs = contents.filter((item: any) => item.type === 'dir');
        
        // For each category directory, get its contents
        for (const categoryDir of categoryDirs) {
          try {
            const categoryUrl = `https://gitee.com/api/v5/repos/${hubOwner}/${hubRepo}/contents/${categoryDir.name}`;
            const categoryResponse = await axios.get(categoryUrl, { timeout: 5000 });
            const categoryContents = categoryResponse.data;
            
            // Filter service directories in this category
            const serviceDirs = categoryContents.filter((item: any) => 
              item.type === 'dir' && !item.name.startsWith('.')
            );
            
            for (const serviceDir of serviceDirs) {
              try {
                // Try to get mcp.json from the service directory
                const manifestUrl = `https://gitee.com/${hubOwner}/${hubRepo}/raw/${hubBranch}/${categoryDir.name}/${serviceDir.name}/mcp.json`;
                const manifestResponse = await axios.get(manifestUrl, { timeout: 5000 });
                const manifest = manifestResponse.data;
                
                // Use category/service-name format to show owner/project
                const fullServiceName = `${categoryDir.name}/${serviceDir.name}`;
                allServices.push({
                  name: fullServiceName,
                  description: manifest.description || `Gitee MCP service: ${serviceDir.name}`,
                  version: manifest.version || '1.0.0',
                  source: 'gitee',
                  tags: manifest.tags || [categoryDir.name, 'gitee', 'mcp'],
                  lastUpdated: serviceDir.commit?.committed_date?.split('T')[0] || new Date().toISOString().split('T')[0]
                });
              } catch (error) {
                // If mcp.json not found, check if it's a direct service
                try {
                  // Try without category prefix
                  const directManifestUrl = `https://gitee.com/${hubOwner}/${hubRepo}/raw/${hubBranch}/${serviceDir.name}/mcp.json`;
                  const directManifestResponse = await axios.get(directManifestUrl, { timeout: 5000 });
                  const directManifest = directManifestResponse.data;
                  
                  const fullServiceName = `${categoryDir.name}/${serviceDir.name}`;
                  allServices.push({
                    name: fullServiceName,
                    description: directManifest.description || `Gitee MCP service: ${serviceDir.name}`,
                    version: directManifest.version || '1.0.0',
                    source: 'gitee',
                    tags: directManifest.tags || ['gitee', 'mcp'],
                    lastUpdated: serviceDir.commit?.committed_date?.split('T')[0] || new Date().toISOString().split('T')[0]
                  });
                } catch (directError) {
                  // If still not found, add basic info
                  const fullServiceName = `${categoryDir.name}/${serviceDir.name}`;
                  allServices.push({
                    name: fullServiceName,
                    description: `Gitee MCP service: ${serviceDir.name}`,
                    version: '1.0.0',
                    source: 'gitee',
                    tags: [categoryDir.name, 'gitee', 'mcp'],
                    lastUpdated: new Date().toISOString().split('T')[0]
                  });
                }
              }
            }
          } catch (categoryError) {
            logger.warn(`Failed to fetch category ${categoryDir.name}:`, categoryError);
            continue;
          }
        }
      } catch (error) {
        logger.warn('Failed to fetch from Gitee hub, using fallback list:', error);
        // Fallback to static list if hub is not accessible
        allServices = [
          {
            name: 'Joooook/12306-mcp',
            description: '12306 train ticket query service',
            version: '1.0.0',
            source: 'gitee',
            tags: ['transport', 'tickets', 'travel', 'china'],
            lastUpdated: '2024-01-15'
          }
        ];
      }

      // Filter services based on query
      const filteredServices = allServices.filter(service => {
        if (!query.trim()) return true;
        
        const searchText = query.toLowerCase();
        return (
          service.name.toLowerCase().includes(searchText) ||
          (service.description && service.description.toLowerCase().includes(searchText)) ||
          (service.tags && service.tags.some(tag => tag.toLowerCase().includes(searchText)))
        );
      });

      // Apply pagination
      const paginatedServices = filteredServices.slice(offset, offset + limit);

      return {
        services: paginatedServices,
        total: filteredServices.length,
        source: this.name,
        hasMore: offset + limit < filteredServices.length
      };
    } catch (error) {
      logger.error('Error searching Gitee registry:', error);
      // Return empty result on error
      return {
        services: [],
        total: 0,
        source: this.name,
        hasMore: false
      };
    }
  }

  async listAvailableServices(): Promise<ServiceInfo[]> {
    const result = await this.searchServices({});
    return result.services;
  }
}

export class DirectRegistrySource implements RegistrySource {
  name = 'direct';

  async fetchManifest(serverNameOrUrl: string): Promise<Manifest> {
    // Support file:// protocol
    if (serverNameOrUrl.startsWith('file://')) {
      const fs = await import('fs/promises');
      const filePath = serverNameOrUrl.slice(7);
      const data = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(data);
    }
    
    // If it's a local file path (doesn't start with http:// or https://)
    if (!serverNameOrUrl.startsWith('http://') && !serverNameOrUrl.startsWith('https://')) {
      const fs = await import('fs/promises');
      const data = await fs.readFile(serverNameOrUrl, 'utf-8');
      return JSON.parse(data);
    }
    
    // HTTP/HTTPS URL
    const response = await axios.get(serverNameOrUrl);
    return response.data;
  }
}

export function createRegistrySource(type: string): RegistrySource {
  switch (type) {
    case 'github':
      return new GitHubRegistrySource();
    case 'gitee':
      return new GiteeRegistrySource();
    case 'direct':
      return new DirectRegistrySource();
    default:
      throw new Error(`Unknown registry source type: ${type}`);
  }
}
