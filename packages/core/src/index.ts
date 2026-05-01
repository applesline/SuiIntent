import { logger } from "./core/logger.js";
/**
 * IntentOrch - Docker for MCP Ecosystem
 * 
 * Allows developers to manage MCP Servers like containers
 * 
 * Main features:
 * 1. MCP Server lifecycle management
 * 2. Natural language intent parsing and execution
 * 3. Workflow orchestration and tracking
 * 4. Runtime adaptation and detection
 * 
 * @package @intentorch/core
 * @version 0.8.0
 */

// ==================== Core Modules ====================
export { ConfigService, getConfigService } from './core/index.js';
export type { RuntimeType, ServiceConfig, Config, AIConfig, DetectionResult } from './core/index.js';

// ==================== AI Modules ====================
export { CloudIntentEngine, LLMClient, getLLMClient } from './ai/index.js';
export type { CloudIntentEngineConfig } from './ai/index.js';

// ==================== Execute Service ====================
export { ExecuteService, getExecuteService, createExecuteService } from './ai/execute-service.js';
export type { UnifiedExecutionOptions, UnifiedExecutionResult, WorkflowExecutionResult } from './ai/execute-service.js';

// ==================== MCP Modules ====================
export { MCPClient, ToolRegistry } from './mcp/index.js';
export type { Tool, ToolCall, ToolMetadata } from './mcp/index.js';

// ==================== Runtime Modules ====================
export { RuntimeDetector, RuntimeAdapter } from './runtime/index.js';

// ==================== Tool Registry ====================
export { ToolRegistry as ToolRegistryModule } from './tool-registry/index.js';

// ==================== Process Management ====================
export { ProcessManager, ProcessStore } from './process-manager/index.js';
export type { ProcessInfo } from './process-manager/types.js';

// ==================== Secret Management ====================
export { SecretManager } from './secret/index.js';

// ==================== Workflow Modules ====================
export * from './workflow/index.js';
export type { Workflow, WorkflowStep, WorkflowInput } from './workflow/types.js';

// ==================== Utility Functions ====================
export * from './utils/index.js';
export { getSqliteDb, closeSqliteDb } from './utils/sqlite.js';

// ==================== Type Definitions ====================
export * from './types/index.js';
export type { DaemonResponse } from './core/types.js';

// ==================== CLI Tools ====================
// Note: CLI modules are not directly exported, used via bin/intorch.js

/**
 * Get IntentOrch version info
 */
export function getVersion(): string {
  return '0.8.0';
}

/**
 * Get system status
 */
export async function getSystemStatus() {
  return {
    version: getVersion(),
    timestamp: new Date().toISOString(),
    modules: {
      core: 'available',
      ai: 'available',
      mcp: 'available',
      runtime: 'available',
      workflow: 'available',
    },
    capabilities: {
      intentParsing: true,
      workflowOrchestration: true,
      mcpServerManagement: true,
      runtimeDetection: true,
    },
  };
}

/**
 * Initialize IntentOrch system
 */
export async function initialize(_config?: Record<string, unknown>) {
  logger.info(`[IntentOrch] Initializing version ${getVersion()}`);
  
  // Add initialization logic here
  // For example: load configuration, initialize services, etc.
  
  return {
    success: true,
    version: getVersion(),
    message: 'IntentOrch initialized successfully',
  };
}

// ==================== Sui DeFi Modules ====================
export { getSuiMCPTools } from './sui/sui-mcp-tools.js';

// ==================== Utility Function Exports ====================
export { getProcessManager } from './process-manager/manager.js';
export { getRegistryClient } from './registry/client.js';
export { getWorkflowManager } from './workflow/manager.js';
export { getToolRegistry } from './tool-registry/registry.js';
export { getIntentService } from './ai/intent-service.js';
export { getAIConfig, getConfigManager } from './utils/config.js';
export { AutoStartManager } from './utils/auto-start-manager.js';
export { printError } from './utils/cli-error.js';
export { PROGRAM_NAME, PROGRAM_DESCRIPTION, PROGRAM_VERSION } from './utils/constants.js';
export { AIProviders, AIProvider, RegistrySources, RegistrySource } from './core/constants.js';
export { getSecretManager } from './secret/manager.js';
export { toLightweightManifest, supportsDynamicDiscovery } from './types/lightweight-manifest.js';
export { getDisplayName } from './utils/server-name.js';
export { DaemonClient } from './daemon/client.js';
export { DaemonServer } from './daemon/server.js';
export { ensureInTorchDir, getDaemonPidPath, getDaemonLogPath, getLogPath } from './utils/paths.js';
export { healthCheckScheduler } from './kernel/health-check-scheduler.js';
export type { DaemonConfig } from './daemon/types.js';

// ==================== Default Export ====================
import { intentorch as adapter } from './ai/intentorch-adapter.js';

const intentorch = {
  getVersion,
  getSystemStatus,
  initialize,
  // Add adapter methods
  configureAI: adapter.configureAI.bind(adapter),
  initCloudIntentEngine: adapter.initCloudIntentEngine.bind(adapter),
  connectMCPServer: adapter.connectMCPServer.bind(adapter),
  processQuery: adapter.processQuery.bind(adapter),
  parseAndPlanWorkflow: adapter.parseAndPlanWorkflow.bind(adapter),
  getConnectedServers: adapter.getConnectedServers.bind(adapter),
  disconnectMCPServer: adapter.disconnectMCPServer.bind(adapter),
  cleanup: adapter.cleanup.bind(adapter),
};

export default intentorch;
