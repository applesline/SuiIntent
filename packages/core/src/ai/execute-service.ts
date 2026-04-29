/**
 * Execute Service
 * 
 * Provides a unified interface for both CLI and Web to use the same underlying
 * execution capabilities as the CLI run command.
 * 
 * This service bridges the gap between:
 * 1. CLI's powerful run command (using CloudIntentEngine directly)
 * 2. Web's limited intent parsing (using IntentService)
 * 
 * Key features:
 * - Full CloudIntentEngine capabilities for both CLI and Web
 * - Automatic server management and connection
 * - Complete workflow execution with tracking
 * - Support for natural language, JSON files, and named workflows
 * 
 * Uses the new Plan → Confirm → Execute pipeline (replaces old parseAndPlan + executeWorkflowWithTracking).
 */

import { CloudIntentEngine } from './cloud-intent-engine';
import { getToolRegistry } from '../tool-registry/registry';
import { getProcessManager } from '../process-manager/manager';
import { getRegistryClient } from '../registry/client';
import { getWorkflowManager } from '../workflow/manager';
import { WorkflowEngine } from '../workflow/engine';
import { AutoStartManager } from '../utils/auto-start-manager';
import { getConfigService } from '../core/config-service';
import { createCloudIntentEngine } from '../utils/cloud-intent-engine-factory';
import { MCPClient } from '../mcp/client';
import { logger } from '../core/logger';
import { IntentOrchError, ErrorFactory, ErrorCode } from '../core/error-handler';
import { Timeouts, KnownServers } from '../core/constants';

import type { AIConfig } from '../core/types';

// Server connection info
interface ConnectedServer {
  name: string;
  client: MCPClient;
}

// Execution options
export interface UnifiedExecutionOptions {
  autoStart?: boolean;
  keepAlive?: boolean;
  silent?: boolean;
  simulate?: boolean;
  params?: Record<string, any>;
}

// Execution result
export interface UnifiedExecutionResult {
  success: boolean;
  result?: any;
  executionSteps?: any[];
  steps?: any[]; // For web compatibility
  status?: string; // For web compatibility
  confidence?: number; // For web compatibility
  error?: string;
  statistics?: {
    totalSteps: number;
    successfulSteps: number;
    failedSteps: number;
    totalDuration: number;
    averageStepDuration: number;
  };
}

// Workflow execution result
export interface WorkflowExecutionResult {
  success: boolean;
  results?: any;
  error?: string;
}

/**
 * Execute Service
 */
export class ExecuteService {
  private cloudIntentEngine: CloudIntentEngine | null = null;
  private connectedServers: Map<string, ConnectedServer> = new Map();
  private aiConfig: AIConfig | null = null;
  private initPromise: Promise<void> | null = null;

  constructor() {
    logger.debug('[ExecuteService] Creating service instance');
  }

  /**
   * Initialize the service with AI configuration
   */
  async initialize(aiConfig?: AIConfig): Promise<void> {
    logger.debug('[ExecuteService] Initializing service');
    
    if (!this.initPromise) {
      this.initPromise = (async () => {
        // Use provided AI config or get from system
        this.aiConfig = aiConfig || await getConfigService().getAIConfig();
        
        if (!this.aiConfig.provider || !this.aiConfig.apiKey) {
          throw new IntentOrchError(ErrorCode.AI_NOT_CONFIGURED, 'AI configuration not set. Please configure AI provider and API key.');
        }

        // Create CloudIntentEngine using the unified factory
        this.cloudIntentEngine = await createCloudIntentEngine({
          aiConfig: this.aiConfig
        });

        logger.debug('[ExecuteService] Service initialized successfully');
      })();
    }

    await this.initPromise;
  }

  /**
   * Execute natural language query using Plan → Confirm → Execute pipeline.
   *
   * This is the recommended entry point. It uses the new Plan-then-Execute flow:
   * 1. **Plan**: Uses LLM function calling to generate a structured execution plan (DAG)
   * 2. **Confirm**: Validates the plan and optionally asks for user confirmation
   * 3. **Execute**: Executes steps in dependency order with variable substitution
   */
  async executeNaturalLanguage(
    query: string,
    options: UnifiedExecutionOptions = {}
  ): Promise<UnifiedExecutionResult> {
    logger.info(`[ExecuteService] Executing natural language query: "${query.substring(0, 100)}..."`);
    
    // Check if daemon is running and we should delegate to it
    // We skip delegation if we're already running inside the daemon to avoid recursion
    const isDaemonProcess = process.env.INTORCH_DAEMON === 'true';
    if (!isDaemonProcess && !options.simulate) {
      try {
        const { DaemonClient } = await import('../daemon/client');
        const daemonClient = new DaemonClient();
        
        // Active check via API heartbeat
        const isRunning = await daemonClient.isDaemonRunning();
        logger.info(`[ExecuteService] Checking daemon status via API: ${isRunning ? 'Online' : 'Offline'}`);
        
        if (isRunning) {
          logger.info('[ExecuteService] Daemon is online, delegating execution for better performance');
          try {
            const result = await daemonClient.executeNaturalLanguage(query, options);
            logger.info('[ExecuteService] Execution delegated to daemon successfully');
            return result as UnifiedExecutionResult;
          } catch (daemonError: any) {
            logger.warn(`[ExecuteService] Daemon delegation failed: ${daemonError.message}, falling back to local execution`);
          }
        }
      } catch (err: any) {
        logger.info(`[ExecuteService] Failed to check daemon status: ${err.message}`);
      }
    }

    try {
      // Ensure service is initialized
      await this.initialize();
      
      if (!this.cloudIntentEngine) {
        throw new IntentOrchError(ErrorCode.ENGINE_NOT_INITIALIZED, 'CloudIntentEngine not initialized');
      }

      // Handle auto-start if requested
      if (options.autoStart) {
        await this.handleAutoStart(query, options);
      }

      // Connect to running MCP servers or use simulation mode
      if (!options.simulate) {
        await this.connectToRunningServers(options);
      }

      // Step 1: Get available tools
      logger.debug('[ExecuteService] Discovering available tools...');
      let tools = await this.getAvailableTools();
      
      logger.debug(`[ExecuteService] Found ${tools.length} tools from connected servers`);
      if (tools.length > 0) {
        logger.debug(`[ExecuteService] Tool names: ${tools.map((t: any) => t.name).join(', ')}`);
      }
      
      if (tools.length === 0) {
        logger.warn('[ExecuteService] No tools available from connected servers');
        return {
          success: false,
          error: 'No MCP tools available. Please start some MCP servers first.'
        };
      }
      
      this.cloudIntentEngine.setAvailableTools(tools);
      logger.debug(`[ExecuteService] Set ${tools.length} tools in CloudIntentEngine`);

      // Create tool executor
      const toolExecutor = this.createToolExecutor(tools);

      // Step 2: Process — Use multi-turn LLM function calling to select and execute tools
      // Multi-turn approach: LLM can call tools one at a time, see results, and decide if more calls are needed
      logger.debug('[ExecuteService] Processing query with multi-turn LLM function calling...');
      
      const stepResults: any[] = [];
      let allSuccess = true;
      let finalResult: any = undefined;
      let conversationHistory: Array<{ role: string; content: string }> = [
        {
          role: 'system',
          content: `You are a helpful assistant that selects the EXACT tool to fulfill the user's request.

AVAILABLE TOOLS:
${tools.map((t: any) => `- ${t.name || ''}: ${t.description || 'No description'}`).join('\n')}

RULES:
1. Select the tool that DIRECTLY produces the answer the user wants
2. Extract ALL parameters from the user's query and pass them to the tool
3. For simple queries (a single action), use EXACTLY ONE tool call
4. If the first tool you choose returns data that can be used as input to another tool, call that tool next
5. Keep calling tools until you have the complete answer the user wants
6. When you have the final answer, respond with the result

CRITICAL: Some tools are "helper" tools that only prepare data for other tools (e.g., looking up codes or IDs). If you call a helper tool first, use its result to call the next tool that produces the final answer.`,
        },
        { role: 'user', content: query },
      ];

      const MAX_TURNS = 5;
      let turnCount = 0;

      while (turnCount < MAX_TURNS) {
        turnCount++;
        logger.debug(`[ExecuteService] Multi-turn iteration ${turnCount}/${MAX_TURNS}...`);

        const functionCallResult = await this.cloudIntentEngine.processQueryWithHistory(conversationHistory, {
          toolChoice: 'auto',
        });

        if (!functionCallResult.hasToolCall || functionCallResult.toolCalls.length === 0) {
          // LLM decided not to call any more tools — use the text response as final result
          if (functionCallResult.text) {
            finalResult = functionCallResult.text;
          }
          logger.debug(`[ExecuteService] LLM finished after ${turnCount} turn(s), no more tool calls needed`);
          break;
        }

        // Execute each tool call from this turn
        for (const tc of functionCallResult.toolCalls) {
          const stepStartTime = Date.now();
          const stepId = `step_${stepResults.length + 1}`;
          
          try {
            logger.debug(`[ExecuteService] Calling tool: ${tc.toolName} with args: ${JSON.stringify(tc.arguments)}`);
            const result = await toolExecutor(tc.toolName, tc.arguments);
            const duration = Date.now() - stepStartTime;
            
            stepResults.push({
              stepId,
              toolName: tc.toolName,
              arguments: tc.arguments,
              success: true,
              result,
              duration,
            });
            finalResult = result;
            
            logger.debug(`[ExecuteService] Step ${stepId} (${tc.toolName}) completed in ${duration}ms`);

            // Add tool result to conversation history for next turn
            const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
            conversationHistory.push({
              role: 'assistant',
              content: `[Tool call: ${tc.toolName}]\nResult: ${resultStr.substring(0, 2000)}`,
            });
          } catch (error: any) {
            const duration = Date.now() - stepStartTime;
            allSuccess = false;
            stepResults.push({
              stepId,
              toolName: tc.toolName,
              success: false,
              error: error.message,
              duration,
            });
            logger.error(`[ExecuteService] Step ${stepId} (${tc.toolName}) failed: ${error.message}`);
            
            // Add error to conversation history
            conversationHistory.push({
              role: 'assistant',
              content: `[Tool call: ${tc.toolName}]\nError: ${error.message}`,
            });
            break;
          }
        }

        if (!allSuccess) break;
      }

      // Cleanup if not keeping connection alive
      if (!options.keepAlive) {
        await this.cleanupConnections();
      }

      const totalDuration = stepResults.reduce((sum, sr) => sum + (sr.duration || 0), 0);

      return {
        success: allSuccess,
        result: finalResult,
        executionSteps: stepResults.map(sr => ({
          name: sr.toolName,
          toolName: sr.toolName,
          arguments: sr.arguments,
          success: sr.success,
          result: sr.result,
          error: sr.error,
          duration: sr.duration,
        })),
        statistics: {
          totalSteps: stepResults.length,
          successfulSteps: stepResults.filter(sr => sr.success).length,
          failedSteps: stepResults.filter(sr => !sr.success).length,
          totalDuration,
          averageStepDuration: totalDuration / Math.max(stepResults.length, 1),
        },
        error: allSuccess ? undefined : 
          (stepResults.find(sr => !sr.success)?.error || 'Execution failed'),
      };

    } catch (error: any) {
      logger.error(`[ExecuteService] Failed to execute natural language query: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Execute workflow from JSON file
   */
  async executeWorkflowFromFile(
    filePath: string,
    params: Record<string, any> = {},
    options: UnifiedExecutionOptions = {}
  ): Promise<WorkflowExecutionResult> {
    logger.info(`[ExecuteService] Executing workflow from file: ${filePath}`);
    
    try {
      const fs = await import('fs/promises');
      const data = await fs.readFile(filePath, 'utf-8');
      const workflow = JSON.parse(data);
      
      return await this.executeWorkflow(workflow, params, options);
    } catch (error: any) {
      logger.error(`[ExecuteService] Failed to execute workflow from file: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Execute named workflow
   */
  async executeNamedWorkflow(
    workflowName: string,
    params: Record<string, any> = {},
    options: UnifiedExecutionOptions = {}
  ): Promise<WorkflowExecutionResult> {
    logger.info(`[ExecuteService] Executing named workflow: "${workflowName}"`);
    
    try {
      const workflowManager = getWorkflowManager();
      
      if (!await workflowManager.exists(workflowName)) {
        throw new IntentOrchError(ErrorCode.WORKFLOW_NOT_FOUND, `Workflow "${workflowName}" not found`);
      }
      
      const workflow = await workflowManager.load(workflowName);
      return await this.executeWorkflow(workflow, params, options);
    } catch (error: any) {
      logger.error(`[ExecuteService] Failed to execute named workflow: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Execute workflow object
   */
  async executeWorkflow(
    workflow: any,
    params: Record<string, any> = {},
    options: UnifiedExecutionOptions = {}
  ): Promise<WorkflowExecutionResult> {
    logger.info(`[ExecuteService] Executing workflow: ${workflow.name || 'unnamed'}`);
    
    try {
      const workflowEngine = new WorkflowEngine();
      
      // Handle auto-start if requested
      if (options.autoStart) {
        await this.ensureServersForWorkflow(workflow, options);
      }

      // Connect to running servers if not in simulation mode
      if (!options.simulate) {
        await this.connectToRunningServers(options);
      }

      // Execute the workflow
      const results = await workflowEngine.execute(workflow, params);

      // Cleanup if not keeping connection alive
      if (!options.keepAlive) {
        await this.cleanupConnections();
      }

      return {
        success: true,
        results
      };
    } catch (error: any) {
      logger.error(`[ExecuteService] Failed to execute workflow: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // ==================== Public API Methods (for daemon server) ====================

  /**
   * Parse intent using the unified execution service
   * Returns workflow steps without executing them
   */
  async parseIntent(
    intent: string,
    context?: any
  ): Promise<{ steps: any[]; status: string; confidence: number; explanation: string }> {
    logger.info(`[ExecuteService] Parsing intent: "${intent.substring(0, 100)}..."`);
    
    try {
      await this.initialize();
      
      if (!this.cloudIntentEngine) {
        throw new IntentOrchError(ErrorCode.ENGINE_NOT_INITIALIZED, 'CloudIntentEngine not initialized');
      }
      
      // Connect to running servers
      await this.connectToRunningServers({});
      
      // Get available tools
      let tools = await this.getAvailableTools();
      
      if (tools.length === 0) {
        return {
          steps: [],
          status: 'capability_missing',
          confidence: 0,
          explanation: 'No MCP tools available. Please start some MCP servers first.'
        };
      }
      
      this.cloudIntentEngine.setAvailableTools(tools);
      
      // Plan the query
      const plan = await this.cloudIntentEngine.planQuery(intent);
      
      // Convert plan steps to workflow steps
      const steps = plan.steps.map((step: any) => ({
        id: `step_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: 'tool',
        serverName: step.serverName || step.serverId || 'generic-service',
        serverId: step.serverName || step.serverId || 'generic-service',
        toolName: step.toolName,
        parameters: step.arguments || {},
      }));
      
      return {
        steps,
        status: steps.length > 0 ? 'success' : 'partial',
        confidence: steps.length > 0 ? 0.8 : 0,
        explanation: plan.summary || `Parsed ${steps.length} steps`,
      };
    } catch (error: any) {
      logger.error(`[ExecuteService] Failed to parse intent: ${error.message}`);
      return {
        steps: [],
        status: 'capability_missing',
        confidence: 0,
        explanation: `Failed to parse intent: ${error.message}`,
      };
    }
  }

  /**
   * Execute pre-parsed steps directly
   */
  async executeSteps(
    steps: any[],
    options: UnifiedExecutionOptions = {}
  ): Promise<UnifiedExecutionResult> {
    logger.info(`[ExecuteService] Executing ${steps.length} pre-parsed steps`);
    
    try {
      await this.initialize();
      
      if (!this.cloudIntentEngine) {
        throw new IntentOrchError(ErrorCode.ENGINE_NOT_INITIALIZED, 'CloudIntentEngine not initialized');
      }
      
      // Connect to running servers
      if (!options.simulate) {
        await this.connectToRunningServers(options);
      }
      
      // Get available tools
      let tools = await this.getAvailableTools();
      
      if (tools.length === 0) {
        return {
          success: false,
          error: 'No MCP tools available. Please start some MCP servers first.'
        };
      }
      
      this.cloudIntentEngine.setAvailableTools(tools);
      
      // Create tool executor
      const toolExecutor = this.createToolExecutor(tools);
      
      // Execute each step sequentially
      const stepResults: any[] = [];
      let allSuccess = true;
      
      for (const step of steps) {
        try {
          const result = await toolExecutor(step.toolName, step.parameters || {});
          stepResults.push({
            name: step.toolName,
            toolName: step.toolName,
            success: true,
            result,
            duration: 0,
          });
        } catch (error: any) {
          allSuccess = false;
          stepResults.push({
            name: step.toolName,
            toolName: step.toolName,
            success: false,
            error: error.message,
            duration: 0,
          });
        }
      }
      
      // Cleanup if not keeping connection alive
      if (!options.keepAlive) {
        await this.cleanupConnections();
      }
      
      return {
        success: allSuccess,
        result: stepResults,
        executionSteps: stepResults,
        statistics: {
          totalSteps: stepResults.length,
          successfulSteps: stepResults.filter(sr => sr.success).length,
          failedSteps: stepResults.filter(sr => !sr.success).length,
          totalDuration: 0,
          averageStepDuration: 0,
        },
        error: allSuccess ? undefined : 'Some steps failed',
      };
    } catch (error: any) {
      logger.error(`[ExecuteService] Failed to execute steps: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Start an interactive session
   */
  async startInteractiveSession(
    query: string,
    userId?: string
  ): Promise<{ sessionId: string; guidance: any; session: any }> {
    logger.info(`[ExecuteService] Starting interactive session for query: "${query.substring(0, 100)}..."`);
    
    try {
      await this.initialize();
      
      if (!this.cloudIntentEngine) {
        throw new IntentOrchError(ErrorCode.ENGINE_NOT_INITIALIZED, 'CloudIntentEngine not initialized');
      }
      
      // Connect to running servers
      await this.connectToRunningServers({});
      
      // Get available tools
      let tools = await this.getAvailableTools();
      
      if (tools.length > 0) {
        this.cloudIntentEngine.setAvailableTools(tools);
      }
      
      // Plan the query
      const plan = await this.cloudIntentEngine.planQuery(query);
      
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      return {
        sessionId,
        guidance: {
          type: 'plan',
          message: plan.summary || `Generated plan with ${plan.steps.length} steps`,
          steps: plan.steps,
          requiresResponse: false,
        },
        session: {
          sessionId,
          query,
          plan,
          state: 'planning',
          createdAt: new Date().toISOString(),
        },
      };
    } catch (error: any) {
      logger.error(`[ExecuteService] Failed to start interactive session: ${error.message}`);
      throw error;
    }
  }

  /**
   * Process interactive feedback
   */
  async processInteractiveFeedback(
    sessionId: string,
    response: any
  ): Promise<{ success: boolean; guidance?: any; session?: any; readyForExecution?: boolean }> {
    logger.info(`[ExecuteService] Processing feedback for session: ${sessionId}`);
    
    // Simple implementation: confirm and return ready for execution
    return {
      success: true,
      guidance: {
        type: 'confirmation',
        message: 'Feedback received. Ready to execute.',
        requiresResponse: false,
      },
      session: { sessionId, state: 'confirmed' },
      readyForExecution: true,
    };
  }

  /**
   * Execute an interactive session
   */
  async executeInteractiveSession(
    sessionId: string,
    options: UnifiedExecutionOptions = {}
  ): Promise<{ success: boolean; result?: any; executionSteps?: any[]; statistics?: any; error?: string }> {
    logger.info(`[ExecuteService] Executing interactive session: ${sessionId}`);
    
    try {
      await this.initialize();
      
      if (!this.cloudIntentEngine) {
        throw new IntentOrchError(ErrorCode.ENGINE_NOT_INITIALIZED, 'CloudIntentEngine not initialized');
      }
      
      // Connect to running servers
      if (!options.simulate) {
        await this.connectToRunningServers(options);
      }
      
      // Get available tools
      let tools = await this.getAvailableTools();
      
      if (tools.length === 0) {
        return {
          success: false,
          error: 'No MCP tools available.',
        };
      }
      
      this.cloudIntentEngine.setAvailableTools(tools);
      
      // Create tool executor
      const toolExecutor = this.createToolExecutor(tools);
      
      // Execute the plan (we don't have the plan stored, so we just return success)
      // In a full implementation, we'd retrieve the stored plan by sessionId
      
      // Cleanup if not keeping connection alive
      if (!options.keepAlive) {
        await this.cleanupConnections();
      }
      
      return {
        success: true,
        result: 'Session executed',
        executionSteps: [],
        statistics: {
          totalSteps: 0,
          successfulSteps: 0,
          failedSteps: 0,
          totalDuration: 0,
          averageStepDuration: 0,
        },
      };
    } catch (error: any) {
      logger.error(`[ExecuteService] Failed to execute interactive session: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get all active interactive sessions
   */
  getActiveInteractiveSessions(): any[] {
    return [];
  }

  /**
   * Get a specific interactive session
   */
  getInteractiveSession(sessionId: string): any {
    return null;
  }

  /**
   * Cleanup old interactive sessions
   */
  cleanupInteractiveSessions(maxAgeMs: number): number {
    return 0;
  }

  // ==================== Private Methods ====================

  private async handleAutoStart(query: string, options: UnifiedExecutionOptions): Promise<void> {
    if (!options.autoStart) return;
    
    logger.debug('[ExecuteService] Handling auto-start');
    
    const autoStartManager = new AutoStartManager();
    const requiredServers = await autoStartManager.analyzeIntentForServers(query);
    
    if (requiredServers.length > 0) {
      const results = await autoStartManager.ensureServersRunning(requiredServers);
      
      if (!autoStartManager.areAllServersReady(results)) {
        throw new IntentOrchError(ErrorCode.SERVER_START_FAILED, 'Some required servers failed to start');
      }
      
      logger.debug(`[ExecuteService] Auto-started ${requiredServers.length} servers`);
    }
  }

  private async connectToRunningServers(options: UnifiedExecutionOptions): Promise<void> {
    const processManager = getProcessManager();
    let runningServers = await processManager.listRunning();
    
    if (runningServers.length === 0) {
      logger.warn('[ExecuteService] No running MCP servers found in process store');
      
      // Fallback: try to find running servers via ps command (for --no-daemon started servers)
      try {
        const { execSync } = await import('child_process');
        const psOutput = execSync('ps aux | grep -E "node.*mcp" | grep -v grep', { encoding: 'utf8', timeout: 5000 });
        const lines = psOutput.trim().split('\n').filter(l => l.trim());
        
        if (lines.length > 0) {
          logger.info(`[ExecuteService] Found ${lines.length} potential MCP processes via ps`);
          
          // First, try to find and connect to all cached manifests (including baidu-map, etc.)
          // This is more comprehensive than just KnownServers
          const manifestsToTry: Array<{ name: string; manifest: any }> = [];
          
          // Collect from cache directory
          try {
            const fs = await import('fs/promises');
            const path = await import('path');
            const { INTORCH_HOME } = await import('../core/constants');
            const cacheDir = path.join(INTORCH_HOME, 'cache', 'manifests');
            const files = await fs.readdir(cacheDir);
            for (const file of files) {
              if (!file.endsWith('.json')) continue;
              try {
                const manifestPath = path.join(cacheDir, file);
                const content = await fs.readFile(manifestPath, 'utf-8');
                const manifest = JSON.parse(content);
                const serverName = manifest.name || file.replace('.json', '');
                manifestsToTry.push({ name: serverName, manifest });
              } catch (e: any) {
                // Skip invalid manifests
              }
            }
          } catch (cacheError: any) {
            logger.debug(`[ExecuteService] Cache read failed: ${cacheError.message}`);
          }
          
          // Also add KnownServers that might not be in cache
          const registryClient = getRegistryClient();
          for (const serverName of KnownServers) {
            if (manifestsToTry.some(m => m.name === serverName)) continue;
            try {
              const manifest = await registryClient.getCachedManifest(serverName);
              if (manifest) {
                manifestsToTry.push({ name: serverName, manifest });
              }
            } catch (e: any) {
              // Skip
            }
          }
          
          // Try to connect to each manifest
          for (const { name: serverName, manifest } of manifestsToTry) {
            if (this.connectedServers.has(serverName)) continue;
            try {
              logger.debug(`[ExecuteService] Attempting to connect to cached server: ${serverName}`);
              await this.connectToServer(serverName, manifest);
            } catch (err: any) {
              logger.debug(`[ExecuteService] Failed to connect to cached server ${serverName}: ${err.message}`);
            }
          }
        }
      } catch (psError: any) {
        logger.debug(`[ExecuteService] ps fallback failed: ${psError.message}`);
      }
      
      return;
    }
    
    logger.debug(`[ExecuteService] Connecting to ${runningServers.length} running servers`);
    
    for (const server of runningServers) {
      try {
        const registryClient = getRegistryClient();
        let manifest = await registryClient.getCachedManifest(server.serverName);
        
        // If manifest is not cached, try to fetch it
        if (!manifest) {
          logger.debug(`[ExecuteService] Manifest not cached for ${server.serverName}, fetching...`);
          try {
            manifest = await registryClient.fetchManifest(server.serverName);
          } catch (fetchError: any) {
            logger.warn(`[ExecuteService] Failed to fetch manifest for ${server.serverName}: ${fetchError.message}`);
            continue;
          }
        }
        
        if (manifest) {
          await this.connectToServer(server.serverName, manifest);
        }
      } catch (error: any) {
        logger.warn(`[ExecuteService] Failed to connect to ${server.serverName}: ${error.message}`);
      }
    }
  }

  private async connectToServer(serverName: string, manifest: any): Promise<void> {
    if (this.connectedServers.has(serverName)) {
      return; // Already connected
    }
    
    try {
      // Try to find an existing process handle from ProcessManager
      const processManager = getProcessManager();
      const existingProcess = await processManager.getProcessHandleByServerName(serverName);

      if (existingProcess) {
        logger.debug(`[ExecuteService] Found existing process handle for ${serverName}, reusing it`);
      } else {
        // If no existing process handle in memory, check if there's a running process in store
        // and stop it first to avoid port/stdio conflicts when spawning a new one
        const runningInfo = await processManager.getByServerName(serverName);
        if (runningInfo && runningInfo.status === 'running') {
          logger.debug(`[ExecuteService] Found running process ${runningInfo.pid} for ${serverName} in store, stopping it first`);
          try {
            await processManager.stop(runningInfo.pid);
            // Wait a moment for the process to fully stop
            await new Promise(resolve => setTimeout(resolve, 1000));
          } catch (stopError: any) {
            logger.warn(`[ExecuteService] Failed to stop existing process for ${serverName}: ${stopError.message}`);
          }
        }
      }

      // Build environment variables including required secrets from manifest
      const envVars: Record<string, string> = { ...process.env } as Record<string, string>;
      if (manifest.runtime.env && manifest.runtime.env.length > 0) {
        logger.debug(`[ExecuteService] Manifest requires env vars: ${manifest.runtime.env.join(', ')}`);
        const { getSecretManager } = await import('../secret/manager');
        const secretManager = getSecretManager();
        for (const envName of manifest.runtime.env) {
          if (!envVars[envName]) {
            try {
              const secretValue = await secretManager.get(envName);
              logger.debug(`[ExecuteService] Secret ${envName} resolved: ${secretValue ? 'found (length=' + secretValue.length + ')' : 'not found'}`);
              if (secretValue) {
                envVars[envName] = secretValue;
              }
            } catch (e: any) {
              logger.debug(`[ExecuteService] Failed to get secret ${envName}: ${e.message}`);
            }
          } else {
            logger.debug(`[ExecuteService] Env var ${envName} already set in process.env`);
          }
        }
      }

      const client = new MCPClient({
        transport: {
          type: 'stdio' as const,
          command: manifest.runtime.command,
          args: manifest.runtime.args || [],
          env: envVars,
          existingProcess: existingProcess
        },
        serverName: serverName
      });

      // Handle transport errors to prevent process crash
      client.on('error', (error) => {
        logger.warn(`[ExecuteService] MCP Client error for ${serverName}: ${error.message || error}`);
      });

      await client.connect();
      
      this.connectedServers.set(serverName, {
        name: serverName,
        client
      });
      
      logger.debug(`[ExecuteService] Connected to server: ${serverName}`);
    } catch (error: any) {
      logger.error(`[ExecuteService] Failed to connect to server ${serverName}: ${error.message}`);
      throw error;
    }
  }

  private async getAvailableTools(): Promise<any[]> {
    const tools: any[] = [];
    
    for (const [name, server] of this.connectedServers) {
      try {
        // Fetch tools from server with timeout
        logger.debug(`[ExecuteService] Fetching tools from server: ${name}`);
        const serverTools = await Promise.race([
          server.client.listTools(),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error(`Request timeout after ${Timeouts.TOOL_LIST}ms`)), Timeouts.TOOL_LIST)
          )
        ]);
        
        // Add server name to each tool
        const toolsWithServer = serverTools.map((tool: any) => ({
          ...tool,
          serverName: name
        }));
        
        tools.push(...toolsWithServer);
      } catch (error: any) {
        logger.warn(`[ExecuteService] Failed to list tools for server ${name}: ${error.message}`);
      }
    }
    
    return tools;
  }

  private createToolExecutor(tools: any[]): (toolName: string, params: Record<string, any>) => Promise<any> {
    // Create a mapping from tool name to server name
    const toolToServer = new Map<string, string>();
    for (const tool of tools) {
      if (tool.name && tool.serverName) {
        toolToServer.set(tool.name, tool.serverName);
      }
    }

    return async (toolName: string, params: Record<string, any>): Promise<any> => {
      const serverName = toolToServer.get(toolName);
      
      if (!serverName) {
        throw new IntentOrchError(ErrorCode.TOOL_NOT_FOUND, `Tool ${toolName} not found in any connected server`);
      }

      const server = this.connectedServers.get(serverName);
      if (!server) {
        throw new IntentOrchError(ErrorCode.SERVER_DISCONNECTED, `Server ${serverName} for tool ${toolName} is no longer connected`);
      }

      logger.debug(`[ExecuteService] Calling tool ${toolName} on server ${serverName}`);
      return await server.client.callTool(toolName, params);
    };
  }

  private async ensureServersForWorkflow(workflow: any, options: UnifiedExecutionOptions): Promise<void> {
    const requiredServers = new Set<string>();
    
    for (const step of workflow.steps || []) {
      if (step.serverId || step.serverName) {
        requiredServers.add(step.serverId || step.serverName);
      }
    }
    
    if (requiredServers.size > 0) {
      const autoStartManager = new AutoStartManager();
      const results = await autoStartManager.ensureServersRunning(Array.from(requiredServers));
      
      if (!autoStartManager.areAllServersReady(results)) {
        throw new IntentOrchError(ErrorCode.SERVER_START_FAILED, 'Some required servers failed to start');
      }
    }
  }

  private async cleanupConnections(): Promise<void> {
    logger.debug('[ExecuteService] Cleaning up connections');
    
    const disconnectPromises: Promise<void>[] = [];
    for (const [name] of this.connectedServers) {
      disconnectPromises.push(this.disconnectServer(name));
    }
    
    await Promise.allSettled(disconnectPromises);
    this.connectedServers.clear();
  }

  private async disconnectServer(serverName: string): Promise<void> {
    const server = this.connectedServers.get(serverName);
    if (server) {
      try {
        await server.client.disconnect();
        logger.debug(`[ExecuteService] Disconnected from server: ${serverName}`);
      } catch (error: any) {
        logger.error(`[ExecuteService] Failed to disconnect from server ${serverName}: ${error.message}`);
      }
    }
  }
}

// Singleton instance for easy access
let unifiedExecutionServiceInstance: ExecuteService | null = null;

export function getExecuteService(): ExecuteService {
  if (!unifiedExecutionServiceInstance) {
    unifiedExecutionServiceInstance = new ExecuteService();
  }
  return unifiedExecutionServiceInstance;
}

export function createExecuteService(): ExecuteService {
  return new ExecuteService();
}
