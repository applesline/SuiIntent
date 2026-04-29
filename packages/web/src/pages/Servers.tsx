import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../services/api';
import { useLanguage } from '../contexts/LanguageContext';
import { formatMCPServerName } from '../utils/format';
import type { MCPServer } from '../types';
import toast from 'react-hot-toast';
import { Search, Layers, Activity, FileJson, Globe, Terminal } from 'lucide-react';

// Registry sources available (official removed)
const REGISTRY_SOURCES = [
  { 
    id: 'github', 
    name: 'GitHub Hub', 
    description: 'Search services from MCPilotX GitHub hub',
    downloadUrl: 'https://raw.githubusercontent.com/MCPilotX/mcp-server-hub/refs/heads/main/github/{server}/mcp.json'
  },
  { 
    id: 'gitee', 
    name: 'Gitee Hub', 
    description: 'Search services from MCPilotX Gitee hub',
    downloadUrl: 'https://gitee.com/mcpilotx/mcp-server-hub/raw/master/{owner}/{server}/mcp.json'
  },
  { 
    id: 'direct', 
    name: 'Direct URL', 
    description: 'Direct URL or local file',
    downloadUrl: 'Direct URL or local file path'
  },
];

// Default Claude Desktop config template
const DEFAULT_CLAUDE_CONFIG = `{
  "mcpServers": {
    "example-server": {
      "command": "node",
      "args": ["path/to/server.js"],
      "env": {
        "API_KEY": "your-api-key"
      }
    }
  }
}`;

// Tab definitions
const TABS = [
  { id: 'mcp-standard', label: 'MCP 标准配置', icon: FileJson },
  { id: 'github', label: 'GitHub Hub', icon: Globe },
  { id: 'gitee', label: 'Gitee Hub', icon: Globe },
] as const;

type TabId = typeof TABS[number]['id'];

export default function Servers() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabId>('mcp-standard');
  const [pullUrl, setPullUrl] = useState('');
  const [selectedSource, setSelectedSource] = useState<string>('github');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{
    name: string;
    description?: string;
    version?: string;
    source: string;
    tags?: string[];
    lastUpdated?: string;
  }>>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [startingServers, setStartingServers] = useState<Set<string>>(new Set());
  const [searchError, setSearchError] = useState<string | null>(null);
  
  // Import config state
  const [importConfigText, setImportConfigText] = useState(DEFAULT_CLAUDE_CONFIG);
  const [importResult, setImportResult] = useState<{ success: boolean; message: string; imported: any[]; total: number } | null>(null);

  // Use React Query for servers list
  const { data: servers = [], isLoading, error: queryError } = useQuery({
    queryKey: ['servers'],
    queryFn: async () => {
      const data = await apiService.getServers();
      const serverMap = new Map<string, MCPServer>();
      data.forEach(server => {
        const existing = serverMap.get(server.name);
        if (!existing || 
            (server.status === 'running' && existing.status !== 'running') ||
            (server.lastStartedAt && existing.lastStartedAt && 
             server.lastStartedAt > existing.lastStartedAt)) {
          serverMap.set(server.name, server);
        }
      });
      return Array.from(serverMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    },
    refetchInterval: 10000,
  });

  // Pull server mutation
  const pullServerMutation = useMutation({
    mutationFn: (serverName: string) => apiService.pullServer({ serverName }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      setPullUrl('');
      toast.success(t('servers.pullSuccess') || 'Server pulled successfully');
    },
    onError: (error: any) => {
      toast.error(error.message || t('servers.error.pullFailed'));
    }
  });

  // Import config mutation
  const importConfigMutation = useMutation({
    mutationFn: (config: string) => apiService.importConfig(config),
    onSuccess: (data) => {
      setImportResult(data);
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      toast.success(data.message || `Successfully imported ${data.total} MCP server(s)`);
    },
    onError: (error: any) => {
      setImportResult({ success: false, message: error.message, imported: [], total: 0 });
      toast.error(error.message || 'Failed to import config');
    }
  });

  // Start server mutation
  const startServerMutation = useMutation({
    mutationFn: (serverId: string) => apiService.startServer({ serverId }),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      queryClient.invalidateQueries({ queryKey: ['processes'] });
      setStartingServers(prev => {
        const next = new Set(prev);
        next.delete(variables);
        return next;
      });
      toast.success(t('servers.startSuccess') || 'Server started successfully');
    },
    onError: (error: any, variables) => {
      setStartingServers(prev => {
        const next = new Set(prev);
        next.delete(variables);
        return next;
      });
      toast.error(error.message || t('servers.error.startFailed'));
    }
  });

  // Stop/Delete server mutation
  const stopServerMutation = useMutation({
    mutationFn: (id: string) => apiService.deleteServer(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      queryClient.invalidateQueries({ queryKey: ['processes'] });
      toast.success(t('servers.stopSuccess') || 'Server stopped successfully');
    },
    onError: (error: any) => {
      toast.error(error.message || t('servers.error.stopFailed'));
    }
  });

  const handlePullServer = async () => {
    if (!pullUrl.trim()) {
      toast.error(t('servers.error.urlRequired'));
      return;
    }

    let serverName = pullUrl;
    if (selectedSource === 'gitee' && serverName.includes('/') && !serverName.startsWith('http')) {
      serverName = `https://gitee.com/mcpilotx/mcp-server-hub/raw/master/${serverName}/mcp.json`;
    } else if (selectedSource === 'github') {
      if (serverName.startsWith('github/') && !serverName.startsWith('http')) {
        const serverPath = serverName.replace('github/', '');
        serverName = `https://raw.githubusercontent.com/MCPilotX/mcp-server-hub/refs/heads/main/github/${serverPath}/mcp.json`;
      } else if (!serverName.includes(':') && !serverName.startsWith('http')) {
        serverName = `github:${serverName}`;
      }
    }

    pullServerMutation.mutate(serverName);
  };

  const handleImportConfig = () => {
    if (!importConfigText.trim()) {
      toast.error('Config content is required');
      return;
    }
    setImportResult(null);
    importConfigMutation.mutate(importConfigText);
  };

  const handleStopServer = (id: string) => {
    if (confirm(t('servers.confirmStop'))) {
      stopServerMutation.mutate(id);
    }
  };

  const handleStartServer = (id: string) => {
    setStartingServers(prev => new Set(prev).add(id));
    startServerMutation.mutate(id);
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }

    try {
      setSearchLoading(true);
      const result = await apiService.searchServices(searchQuery, selectedSource);
      setSearchResults(result.services);
      setShowSearchResults(true);
      setSearchError(null);
      
      // Show message if no results found
      if (result.services.length === 0) {
        setSearchError(t('servers.noSearchResults'));
      }
    } catch (err: any) {
      // Show error message if search fails
      setSearchError(err.message || t('servers.error.searchFailed'));
      setSearchResults([]);
      setShowSearchResults(false);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleSelectSearchResult = (serviceName: string, serviceSource?: string) => {
    setPullUrl(serviceName);
    if (serviceSource) {
      if (serviceSource.includes('github')) {
        setSelectedSource('github');
      } else if (serviceSource.includes('gitee')) {
        setSelectedSource('gitee');
      } else if (serviceSource.includes('direct') || serviceSource.includes('url')) {
        setSelectedSource('direct');
      }
    }
    setShowSearchResults(false);
  };

  const getActualDownloadUrl = (): string => {
    const source = REGISTRY_SOURCES.find(s => s.id === selectedSource);
    if (!source) return '';
    if (selectedSource === 'direct') return source.downloadUrl;
    if (!pullUrl.trim()) return source.downloadUrl;
    
    if (selectedSource === 'gitee') {
      if (pullUrl.includes('/') && !pullUrl.startsWith('http')) {
        return `https://gitee.com/mcpilotx/mcp-server-hub/raw/master/${pullUrl}/mcp.json`;
      }
    } else if (selectedSource === 'github') {
      if (pullUrl.startsWith('github/') && !pullUrl.startsWith('http')) {
        const serverPath = pullUrl.replace('github/', '');
        return `https://raw.githubusercontent.com/MCPilotX/mcp-server-hub/refs/heads/main/github/${serverPath}/mcp.json`;
      } else if (pullUrl.includes('/') && !pullUrl.includes(':')) {
        return `github:${pullUrl}`;
      }
    }
    return source.downloadUrl;
  };

  if (isLoading && servers.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">{t('servers.loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{t('servers.title')}</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">{t('servers.subtitle')}</p>
      </div>

      {queryError && (
        <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-sm text-red-700 dark:text-red-400">{(queryError as Error).message}</p>
        </div>
      )}

      {/* Tabbed Pull / Import Section */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        {/* Tab Header */}
        <div className="border-b border-gray-200 dark:border-gray-700">
          <nav className="flex" aria-label="Tabs">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id);
                    // Reset import result when switching tabs
                    if (tab.id !== 'mcp-standard') {
                      setImportResult(null);
                    }
                  }}
                  className={`flex items-center space-x-2 px-6 py-3.5 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === tab.id
                      ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {/* MCP Standard Config Tab */}
          {activeTab === 'mcp-standard' && (
            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <Terminal className="h-5 w-5 text-primary-500" />
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                  Import Claude Desktop Config
                </h3>
              </div>
              
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Paste your Claude Desktop MCP configuration below. The system will automatically parse it and convert each server entry into a compatible format.
              </p>
              
              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                <p className="text-xs text-blue-700 dark:text-blue-400">
                  <strong>Format:</strong> Claude Desktop uses <code className="bg-blue-100 dark:bg-blue-900/40 px-1 rounded">mcpServers</code> field with server name, command, args, and env.
                  Each server will be automatically converted to IntentOrch manifest format.
                </p>
              </div>
              
              <textarea
                value={importConfigText}
                onChange={(e) => setImportConfigText(e.target.value)}
                className="w-full h-64 px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 font-mono text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                placeholder={DEFAULT_CLAUDE_CONFIG}
                spellCheck={false}
              />
              
              {importResult && (
                <div className={`p-4 rounded-lg border ${
                  importResult.success 
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' 
                    : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                }`}>
                  <p className={`text-sm font-medium ${
                    importResult.success ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'
                  }`}>
                    {importResult.message}
                  </p>
                  {importResult.imported && importResult.imported.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {importResult.imported.map((item, idx) => (
                        <li key={idx} className="text-xs text-gray-600 dark:text-gray-400">
                          ✓ {item.name} (v{item.version})
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              
              <div className="flex justify-end">
                <button
                  onClick={handleImportConfig}
                  disabled={importConfigMutation.isPending || !importConfigText.trim()}
                  className="px-6 py-2 text-sm bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-50 transition-colors"
                >
                  {importConfigMutation.isPending ? 'Importing...' : 'Import Config'}
                </button>
              </div>
            </div>
          )}

          {/* GitHub Hub Tab */}
          {activeTab === 'github' && (
            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <Globe className="h-5 w-5 text-primary-500" />
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                  GitHub Hub
                </h3>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('servers.searchServers')}
                </label>
                <div className="flex space-x-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                      placeholder={t('servers.searchPlaceholder', { source: 'GitHub Hub' })}
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </div>
                  <button
                    onClick={handleSearch}
                    disabled={searchLoading}
                    className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-50"
                  >
                    {searchLoading ? 'Searching...' : t('common.search')}
                  </button>
                </div>
                
                {showSearchResults && (
                  <div className="mt-3 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-gray-50 dark:bg-gray-900/30">
                    <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                      <span className="text-sm font-medium">Search Results ({searchResults.length})</span>
                      <button onClick={() => setShowSearchResults(false)} className="text-xs text-primary-500">Close</button>
                    </div>
                    <div className="max-h-60 overflow-auto divide-y divide-gray-200 dark:divide-gray-700">
                      {searchResults.map((service, index) => (
                        <div
                          key={index}
                          className="px-4 py-3 hover:bg-white dark:hover:bg-gray-800 cursor-pointer"
                          onClick={() => handleSelectSearchResult(service.name, service.source)}
                        >
                          <div className="font-medium text-gray-900 dark:text-white">{service.name}</div>
                          {service.description && <div className="text-sm text-gray-500 truncate">{service.description}</div>}
                        </div>
                      ))}
                      {searchResults.length === 0 && !searchLoading && <div className="p-4 text-center text-gray-500">No results found</div>}
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('servers.pullDescription')}
                </label>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={pullUrl}
                    onChange={(e) => setPullUrl(e.target.value)}
                    placeholder="github/owner/repo 或 owner/repo"
                    className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800"
                    onKeyDown={(e) => e.key === 'Enter' && handlePullServer()}
                  />
                  <button
                    onClick={handlePullServer}
                    disabled={pullServerMutation.isPending || !pullUrl.trim()}
                    className="px-6 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-50"
                  >
                    {pullServerMutation.isPending ? 'Pulling...' : t('servers.pullButton')}
                  </button>
                </div>
              </div>

              <div className="p-3 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg">
                <div className="flex items-start">
                  <Activity className="h-5 w-5 text-gray-400 mt-0.5" />
                  <div className="ml-3">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {t('servers.downloadUrlInfo')}: GitHub Hub
                    </p>
                    <div className="mt-1 p-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-xs font-mono text-gray-800 dark:text-gray-200 break-all">
                      {getActualDownloadUrl()}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Gitee Hub Tab */}
          {activeTab === 'gitee' && (
            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <Globe className="h-5 w-5 text-primary-500" />
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                  Gitee Hub
                </h3>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('servers.searchServers')}
                </label>
                <div className="flex space-x-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                      placeholder={t('servers.searchPlaceholder', { source: 'Gitee Hub' })}
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </div>
                  <button
                    onClick={handleSearch}
                    disabled={searchLoading}
                    className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-50"
                  >
                    {searchLoading ? 'Searching...' : t('common.search')}
                  </button>
                </div>
                
                {showSearchResults && (
                  <div className="mt-3 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-gray-50 dark:bg-gray-900/30">
                    <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                      <span className="text-sm font-medium">Search Results ({searchResults.length})</span>
                      <button onClick={() => setShowSearchResults(false)} className="text-xs text-primary-500">Close</button>
                    </div>
                    <div className="max-h-60 overflow-auto divide-y divide-gray-200 dark:divide-gray-700">
                      {searchResults.map((service, index) => (
                        <div
                          key={index}
                          className="px-4 py-3 hover:bg-white dark:hover:bg-gray-800 cursor-pointer"
                          onClick={() => handleSelectSearchResult(service.name, service.source)}
                        >
                          <div className="font-medium text-gray-900 dark:text-white">{service.name}</div>
                          {service.description && <div className="text-sm text-gray-500 truncate">{service.description}</div>}
                        </div>
                      ))}
                      {searchResults.length === 0 && !searchLoading && <div className="p-4 text-center text-gray-500">No results found</div>}
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('servers.pullDescription')}
                </label>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={pullUrl}
                    onChange={(e) => setPullUrl(e.target.value)}
                    placeholder="owner/server-name"
                    className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800"
                    onKeyDown={(e) => e.key === 'Enter' && handlePullServer()}
                  />
                  <button
                    onClick={handlePullServer}
                    disabled={pullServerMutation.isPending || !pullUrl.trim()}
                    className="px-6 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-50"
                  >
                    {pullServerMutation.isPending ? 'Pulling...' : t('servers.pullButton')}
                  </button>
                </div>
              </div>

              <div className="p-3 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg">
                <div className="flex items-start">
                  <Activity className="h-5 w-5 text-gray-400 mt-0.5" />
                  <div className="ml-3">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {t('servers.downloadUrlInfo')}: Gitee Hub
                    </p>
                    <div className="mt-1 p-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-xs font-mono text-gray-800 dark:text-gray-200 break-all">
                      {getActualDownloadUrl()}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Pulled Servers List */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-medium text-gray-900 dark:text-white">{t('servers.pulledServers')}</h2>
        </div>
        
        {servers.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <Layers className="mx-auto h-12 w-12 opacity-20 mb-4" />
            <p>{t('servers.noServers')}</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-200 dark:divide-gray-700">
            {servers.map((server) => (
              <li key={server.id} className="px-6 py-4 hover:bg-gray-50 dark:hover:bg-gray-900/50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className={`h-2.5 w-2.5 rounded-full ${server.status === 'running' ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{formatMCPServerName(server.name)}</p>
                      <p className="text-xs text-gray-500">v{server.version} • {server.status}</p>
                    </div>
                  </div>
                  <div className="flex space-x-2">
                    {server.status === 'running' ? (
                      <button
                        onClick={() => handleStopServer(server.id)}
                        className="px-3 py-1.5 text-xs bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 rounded-md hover:bg-red-200 transition-colors"
                      >
                        {t('servers.stop')}
                      </button>
                    ) : (
                      <button
                        onClick={() => handleStartServer(server.id)}
                        disabled={startingServers.has(server.id)}
                        className="px-3 py-1.5 text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded-md hover:bg-green-200 transition-colors disabled:opacity-50"
                      >
                        {startingServers.has(server.id) ? 'Starting...' : t('servers.start')}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
