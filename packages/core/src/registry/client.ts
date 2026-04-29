import { logger } from "../core/logger";
import { Manifest, RegistrySource, ServiceInfo, SearchOptions, SearchResult } from './types';
import { createRegistrySource, parseClaudeDesktopConfig } from './sources';
import { ManifestCache } from './cache';
import { getRegistryConfig } from '../utils/config';

export class RegistryClient {
  private cache: ManifestCache;
  private sources: Map<string, RegistrySource>;

  constructor() {
    this.cache = new ManifestCache();
    this.sources = new Map();
    
    // Initialize default sources (official source removed, use github/gitee directly)
    this.sources.set('github', createRegistrySource('github'));
    this.sources.set('gitee', createRegistrySource('gitee'));
    this.sources.set('direct', createRegistrySource('direct'));
  }

  /**
   * Import MCP config (Claude Desktop format) and cache all manifests
   * Returns the list of imported manifests
   */
  async importConfig(configJson: string): Promise<Manifest[]> {
    const manifests = parseClaudeDesktopConfig(configJson);
    
    for (const manifest of manifests) {
      const cacheKey = this.generateCacheKey(manifest.name);
      await this.cache.set(cacheKey, manifest);
      logger.info(`[RegistryClient] Imported and cached manifest: ${manifest.name}`);
      
      // Auto-register env values as secrets if they exist
      if (manifest.runtime?.env && manifest.runtime.env.length > 0) {
        try {
          const { getSecretManager } = await import('../secret/manager');
          const secretManager = getSecretManager();
          
          // Parse the original config to get env values (runtime.env only has keys)
          const data = JSON.parse(configJson);
          const servers = data.mcpServers || {};
          const entry = servers[manifest.name];
          
          if (entry && entry.env && typeof entry.env === 'object') {
            for (const [key, value] of Object.entries(entry.env)) {
              if (value && typeof value === 'string') {
                const existingSecret = await secretManager.get(key);
                if (!existingSecret) {
                  await secretManager.set(key, value);
                  logger.info(`[RegistryClient] Auto-registered secret: ${key} from imported config`);
                }
              }
            }
          }
        } catch (secretError) {
          logger.warn(`[RegistryClient] Failed to auto-register secrets for ${manifest.name}:`, secretError);
        }
      }
    }
    
    return manifests;
  }

  async fetchManifest(serverNameOrUrl: string): Promise<Manifest> {
    logger.info(`[RegistryClient] Fetching manifest for: ${serverNameOrUrl}`);
    // Generate cache key (for URLs, extract meaningful name)
    const cacheKey = this.generateCacheKey(serverNameOrUrl);
    logger.info(`[RegistryClient] Generated cache key: ${cacheKey}`);
    
    // Check cache first
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      logger.info(`[RegistryClient] Found in cache: ${cacheKey}`);
      return cached;
    }

    // Check if it's a URL or local file path
    if (serverNameOrUrl.startsWith('http://') || 
        serverNameOrUrl.startsWith('https://') ||
        serverNameOrUrl.startsWith('file://') ||
        serverNameOrUrl.endsWith('.json')) {
      logger.info(`[RegistryClient] Using DirectSource for URL/path`);
      const directSource = this.sources.get('direct')!;
      const manifest = await directSource.fetchManifest(serverNameOrUrl);
      logger.info(`[RegistryClient] Fetched manifest from DirectSource:`, JSON.stringify(manifest).substring(0, 100));
      // Cache the result
      await this.cache.set(cacheKey, manifest);
      return manifest;
    }

    // Check if it has a source prefix (e.g., gitee:12306, github:owner/repo)
    const sourcePrefixMatch = serverNameOrUrl.match(/^([a-z]+):(.+)$/);
    if (sourcePrefixMatch) {
      const [, sourceType, actualName] = sourcePrefixMatch;
      const source = this.sources.get(sourceType);
      if (source) {
        const manifest = await source.fetchManifest(actualName);
        // Cache the result
        await this.cache.set(cacheKey, manifest);
        return manifest;
      }
      // If source not found, continue with normal flow
    }

    // Check if it's a GitHub repository identifier (format: owner/repo[@branch][:path])
    // GitHub identifiers contain exactly one slash (owner/repo) and may contain @ or :
    const isGitHubRepo = this.isGitHubRepositoryIdentifier(serverNameOrUrl);
    
    // Check if it's a local file path (contains / or \ but not a GitHub repo)
    const isLocalPath = (serverNameOrUrl.includes('/') || serverNameOrUrl.includes('\\')) && 
                       !isGitHubRepo;

    if (isLocalPath) {
      const directSource = this.sources.get('direct')!;
      const manifest = await directSource.fetchManifest(serverNameOrUrl);
      // Cache the result
      await this.cache.set(cacheKey, manifest);
      return manifest;
    }

    // Fetch from Registry
    const registryConfig = await getRegistryConfig();
    let manifest: Manifest | null = null;
    let lastError: Error | null = null;

    // Try default source
    try {
      const source = this.sources.get(registryConfig.default);
      if (source) {
        manifest = await source.fetchManifest(serverNameOrUrl);
      }
    } catch (err) {
      lastError = err as Error;
    }

    // If default source fails, try fallback source
    if (!manifest && registryConfig.fallback) {
      try {
        const fallbackSource = this.sources.get(registryConfig.fallback);
        if (fallbackSource) {
          manifest = await fallbackSource.fetchManifest(serverNameOrUrl);
        }
      } catch (err) {
        lastError = err as Error;
      }
    }

    if (!manifest) {
      throw new Error(
        `Failed to fetch manifest for ${serverNameOrUrl}: ${lastError?.message || 'Unknown error'}`
      );
    }

    // Cache result
    await this.cache.set(cacheKey, manifest);
    return manifest;
  }

  async getCachedManifest(serverName: string): Promise<Manifest | null> {
    try {
      const cacheKey = this.generateCacheKey(serverName);
      const manifest = await this.cache.get(cacheKey);
      
      if (!manifest) {
        // Try alternative cache key formats
        logger.warn(`⚠️  Manifest not found for cache key: ${cacheKey}`);
        logger.warn(`   Trying alternative formats...`);
        
        // Try without owner prefix (just the server name)
        const parts = serverName.split('/');
        if (parts.length > 1) {
          const serverNameOnly = parts[parts.length - 1];
          const alternativeKey = this.generateCacheKey(serverNameOnly);
          logger.warn(`   Trying alternative key: ${alternativeKey}`);
          const altManifest = await this.cache.get(alternativeKey);
          if (altManifest) {
            logger.warn(`   ✓ Found manifest with alternative key`);
            return altManifest;
          }
        }
        
        // Try with @ prefix
        if (!serverName.startsWith('@')) {
          const withAtPrefix = `@${serverName}`;
          const alternativeKey = this.generateCacheKey(withAtPrefix);
          logger.warn(`   Trying alternative key: ${alternativeKey}`);
          const altManifest = await this.cache.get(alternativeKey);
          if (altManifest) {
            logger.warn(`   ✓ Found manifest with @ prefix`);
            return altManifest;
          }
        }
        
        logger.warn(`   ✗ No manifest found with any alternative key`);
      }
      
      return manifest;
    } catch (error) {
      logger.error(`❌ Error getting cached manifest for ${serverName}:`, error);
      return null;
    }
  }

  /**
   * Cache a manifest for a server
   * This is useful for caching lightweight manifests or updated manifests
   */
  async cacheManifest(serverName: string, manifest: Manifest): Promise<void> {
    try {
      const cacheKey = this.generateCacheKey(serverName);
      logger.info(`[RegistryClient] Caching manifest for ${serverName} with key: ${cacheKey}`);
      await this.cache.set(cacheKey, manifest);
      logger.info(`[RegistryClient] ✓ Manifest cached successfully`);
    } catch (error) {
      logger.error(`[RegistryClient] ❌ Failed to cache manifest for ${serverName}:`, error);
      throw error;
    }
  }

  async hasCachedManifest(serverName: string): Promise<boolean> {
    return this.cache.has(serverName);
  }

  async clearCache(): Promise<void> {
    await this.cache.clear();
  }

  registerSource(name: string, source: RegistrySource): void {
    this.sources.set(name, source);
  }

  async listCachedManifests(): Promise<string[]> {
    return this.cache.list();
  }

  async searchServices(options: SearchOptions): Promise<SearchResult> {
    const { source: sourceName, query = '', limit = 20, offset = 0 } = options;
    
    // If source is specified, search only that source
    if (sourceName && this.sources.has(sourceName)) {
      const source = this.sources.get(sourceName)!;
      if (source.searchServices) {
        return source.searchServices({ query, limit, offset });
      } else {
        // Source doesn't support search, return empty result
        return {
          services: [],
          total: 0,
          source: sourceName,
          hasMore: false
        };
      }
    }
    
    // If no source specified, search all sources that support search
    const searchPromises: Promise<SearchResult>[] = [];
    const sourceNames: string[] = [];
    
    for (const [name, source] of this.sources.entries()) {
      if (source.searchServices) {
        searchPromises.push(source.searchServices({ query, limit, offset }));
        sourceNames.push(name);
      }
    }
    
    if (searchPromises.length === 0) {
      // No sources support search
      return {
        services: [],
        total: 0,
        source: 'none',
        hasMore: false
      };
    }
    
    try {
      const results = await Promise.all(searchPromises);
      
      // Combine results from all sources
      const allServices: ServiceInfo[] = [];
      let total = 0;
      
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        allServices.push(...result.services);
        total += result.total;
      }
      
      // Apply global pagination (since each source already applied its own pagination,
      // we need to handle this differently for combined results)
      // For simplicity, we'll just return all combined results with pagination
      const paginatedServices = allServices.slice(offset, offset + limit);
      
      return {
        services: paginatedServices,
        total,
        source: sourceNames.join(','),
        hasMore: offset + limit < total
      };
    } catch (error) {
      logger.error('Error searching services:', error);
      return {
        services: [],
        total: 0,
        source: 'error',
        hasMore: false
      };
    }
  }

  async listAvailableServices(source?: string): Promise<ServiceInfo[]> {
    const options: SearchOptions = {};
    if (source) {
      options.source = source;
    }
    
    const result = await this.searchServices(options);
    return result.services;
  }

  private isGitHubRepositoryIdentifier(identifier: string): boolean {
    // GitHub repository identifier format: owner/repo[@branch][:path]
    // Examples: github/github-mcp-server, owner/repo@main, owner/repo:path/to/file
    
    // Remove optional @branch and :path parts to check basic format
    let baseIdentifier = identifier;
    
    // Remove :path part if present
    const pathIndex = identifier.indexOf(':');
    if (pathIndex > -1) {
      baseIdentifier = identifier.substring(0, pathIndex);
    }
    
    // Remove @branch part if present
    const branchIndex = baseIdentifier.indexOf('@');
    if (branchIndex > -1) {
      baseIdentifier = baseIdentifier.substring(0, branchIndex);
    }
    
    // Check if it's in owner/repo format (exactly one slash)
    const slashCount = (baseIdentifier.match(/\//g) || []).length;
    return slashCount === 1 && !baseIdentifier.includes('.') && !baseIdentifier.includes('\\');
  }

  generateCacheKey(serverNameOrUrl: string): string {
    // If it's a URL, extract meaningful name from it
    if (serverNameOrUrl.startsWith('http://') || 
        serverNameOrUrl.startsWith('https://')) {
      try {
        const url = new URL(serverNameOrUrl);
        const pathname = url.pathname;
        
        // Extract service name from common URL patterns
        // Pattern 1: GitHub hub URL - https://raw.githubusercontent.com/MCPilotX/mcp-server-hub/main/github/github-mcp-server/mcp.json
        // Pattern 2: Gitee hub URL - https://gitee.com/mcpilotx/mcp-server-hub/raw/master/Joooook/12306-mcp/mcp.json
        // Pattern 3: Direct GitHub repo URL - https://raw.githubusercontent.com/owner/repo/main/mcp.json
        
        // Remove /mcp.json suffix first, then .json suffix
        let servicePath = pathname;
        if (servicePath.endsWith('/mcp.json')) {
          servicePath = servicePath.substring(0, servicePath.length - 9); // Remove "/mcp.json"
        } else if (servicePath.endsWith('.json')) {
          servicePath = servicePath.substring(0, servicePath.length - 5); // Remove ".json"
        }
        
        // GitHub hub pattern (MCPilotX hub): /MCPilotX/mcp-server-hub/main/github/github-mcp-server
        // Also handles: /MCPilotX/mcp-server-hub/refs/heads/main/github/github-mcp-server
        // Note: after removing /mcp.json, we have: /MCPilotX/mcp-server-hub/main/github/github-mcp-server
        // Use a more flexible pattern to match branch names that may contain slashes
        const githubHubMatch = servicePath.match(/\/[^\/]+\/mcp-server-hub\/(?:[^\/]+\/)*github\/(.+)/);
        if (githubHubMatch) {
          const serviceName = githubHubMatch[1];
          // If it doesn't contain a slash, add "github/" prefix
          if (!serviceName.includes('/')) {
            return `github/${serviceName}`;
          }
          return serviceName;
        }
        
        // Gitee hub pattern (mcpilotx hub): /mcpilotx/mcp-server-hub/raw/master/Joooook/12306-mcp
        // Note: after removing /mcp.json, we have: /mcpilotx/mcp-server-hub/raw/master/Joooook/12306-mcp
        const giteeHubMatch = servicePath.match(/^\/mcpilotx\/mcp-server-hub\/raw\/master\/(.+)$/);
        if (giteeHubMatch) {
          // Return as-is without "gitee/" prefix (should be in owner/server format)
          return giteeHubMatch[1];
        }
        
        // GitHub hub pattern for non-github directory: /MCPilotX/mcp-server-hub/main/some-other-service
        // Also handles: /MCPilotX/mcp-server-hub/refs/heads/main/some-other-service
        const githubHubGenericMatch = servicePath.match(/\/[^\/]+\/mcp-server-hub\/(?:[^\/]+\/)*([^\/].+)/);
        if (githubHubGenericMatch) {
          const serviceName = githubHubGenericMatch[1];
          // Check if the first part is a common branch name or refs/heads/branch
          const parts = serviceName.split('/');
          const commonBranches = ['main', 'master', 'develop', 'dev', 'trunk', 'release'];
          
          // Handle refs/heads/main pattern
          if (parts.length >= 3 && parts[0] === 'refs' && parts[1] === 'heads' && commonBranches.includes(parts[2])) {
            // Skip refs/heads/main
            return parts.slice(3).join('/');
          }
          
          // Handle simple branch name
          if (parts.length >= 2 && commonBranches.includes(parts[0])) {
            // First part is a branch name, skip it
            return parts.slice(1).join('/');
          }
          return serviceName;
        }
        
        // Direct GitHub raw URL pattern: /owner/repo/main/mcp.json
        // We need to handle both with and without branch name
        const rawGithubMatch = servicePath.match(/\/raw\/[^\/]+\/(.+)/);
        if (rawGithubMatch) {
          const fullPath = rawGithubMatch[1];
          // Split by / to analyze
          const parts = fullPath.split('/');
          
          // If we have at least 2 parts, check if last part is a common branch name
          if (parts.length >= 2) {
            const lastPart = parts[parts.length - 1];
            const commonBranches = ['main', 'master', 'develop', 'dev', 'trunk', 'release'];
            
            // If last part is a branch name, remove it
            if (commonBranches.includes(lastPart)) {
              // Return owner/repo
              if (parts.length >= 3) {
                const owner = parts[parts.length - 3];
                const repo = parts[parts.length - 2];
                return `${owner}/${repo}`;
              }
            } else {
              // Last part is not a branch, could be filename or service name
              // Try to extract owner/repo from the path
              for (let i = parts.length - 1; i >= 1; i--) {
                const potentialOwner = parts[i - 1];
                const potentialRepo = parts[i];
                // Simple check: if neither contains dot, it's likely owner/repo
                if (!potentialOwner.includes('.') && !potentialRepo.includes('.')) {
                  return `${potentialOwner}/${potentialRepo}`;
                }
              }
            }
          }
          
          // Fallback: return the full path without branch/file extension
          return fullPath;
        }
        
        // Generic pattern: try to extract owner/server from path
        const segments = servicePath.split('/').filter(seg => seg.length > 0);
        if (segments.length >= 2) {
          // Common branch names to skip
          const commonBranches = ['main', 'master', 'develop', 'dev', 'trunk', 'release'];
          
          // Check if we have a pattern like /owner/repo/branch
          if (segments.length >= 3 && commonBranches.includes(segments[segments.length - 1])) {
            // Return owner/repo
            const owner = segments[segments.length - 3];
            const repo = segments[segments.length - 2];
            return `${owner}/${repo}`;
          }
          
          // Default: use last two segments
          const owner = segments[segments.length - 2];
          const server = segments[segments.length - 1];
          return `${owner}/${server}`;
        } else if (segments.length === 1) {
          return segments[0];
        }
      } catch (error) {
        logger.warn('Failed to parse URL for cache key generation:', error);
      }
    }
    
    // For non-URLs or if URL parsing failed, use the original string
    return serverNameOrUrl;
  }
}

// Singleton instance
let registryClient: RegistryClient | null = null;

export function getRegistryClient(): RegistryClient {
  if (!registryClient) {
    registryClient = new RegistryClient();
  }
  return registryClient;
}
