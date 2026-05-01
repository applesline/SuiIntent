/**
 * Cloud LLM Intent Engine
 * Cloud LLM-based intent parsing and MCP capability auto-mapping engine
 *
 * Core capabilities:
 * 1. Plan: Generate a tool execution plan (DAG) from a user query using LLM function calling
 * 2. Confirm: Validate and confirm the plan with user interaction
 * 3. Execute: Execute steps in dependency order with variable substitution
 *
 * This replaces the old parseIntent + selectTools + executeWorkflowWithTracking pipeline.
 * - Old: 2 LLM calls (text prompt parseIntent + text prompt selectTools) + 5-layer fallback
 * - New: 1 LLM call (function calling) directly generates the plan with tool + params
 */

import { logger } from "../core/logger.js";
import { LLMClient, getLLMClient } from "./llm-client.js";
import type { AIConfig } from "../core/types.js";
import type { Tool } from "../mcp/types.js";
import { ParameterMapper, ValidationLevel } from "../mcp/parameter-mapper.js";
import { Timeouts, LLMDefaults } from "../core/constants.js";
import type {
  LLMMessage,
  LLMResponse as LLMClientResponse,
} from "./llm-client.js";

// ==================== Plan-then-Execute Types ====================

/**
 * A single step in a tool execution plan
 */
export interface PlanStep {
  /** Unique step ID (e.g., "step_1", "step_2") */
  id: string;
  /** Tool name to execute */
  toolName: string;
  /** Server name that provides this tool */
  serverName?: string;
  /** Human-readable description of what this step does */
  description: string;
  /** Parameters for the tool call */
  arguments: Record<string, unknown>;
  /** IDs of steps that this step depends on */
  dependsOn: string[];
}

/**
 * A complete tool execution plan (DAG)
 */
export interface ToolExecutionPlan {
  /** Unique plan ID */
  id: string;
  /** Original user query */
  query: string;
  /** Steps to execute in order */
  steps: PlanStep[];
  /** Whether the plan was confirmed by the user */
  confirmed: boolean;
  /** Timestamp when the plan was created */
  createdAt: Date;
  /** Timestamp when the plan was confirmed (if confirmed) */
  confirmedAt?: Date;
  /** Human-readable summary of the plan */
  summary: string;
}

/**
 * Plan execution result
 */
export interface PlanExecutionResult {
  /** Whether all steps executed successfully */
  success: boolean;
  /** Plan that was executed */
  plan: ToolExecutionPlan;
  /** Results for each step */
  stepResults: Array<{
    stepId: string;
    toolName: string;
    success: boolean;
    result?: unknown;
    error?: string;
    duration: number;
  }>;
  /** Final result (output of the last step) */
  finalResult?: unknown;
  /** Total execution duration */
  totalDuration: number;
}

/**
 * Plan confirmation callback
 */
export interface PlanConfirmationCallback {
  (plan: ToolExecutionPlan): Promise<{
    confirmed: boolean;
    modifiedPlan?: ToolExecutionPlan;
    feedback?: string;
  }>;
}

// ==================== Configuration Interface ====================

export interface CloudIntentEngineConfig {
  llm: {
    provider: AIConfig["provider"];
    apiKey?: string;
    endpoint?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    timeout?: number;
    maxRetries?: number;
  };
  execution: {
    maxConcurrentTools?: number;
    timeout?: number;
    retryAttempts?: number;
    retryDelay?: number;
  };
  fallback: {
    enableKeywordMatching?: boolean;
    askUserOnFailure?: boolean;
    defaultTools?: Record<string, string>;
  };
  parameterMapping?: {
    validationLevel?: ValidationLevel;
    enableCompatibilityMappings?: boolean;
    logWarnings?: boolean;
    enforceRequired?: boolean;
  };
}

// ==================== Execution Context ====================

interface ExecutionContext {
  results: Map<string, unknown>;
  variables: Map<string, unknown>;
}

// ==================== Function Calling Result Type ====================

/**
 * Result of a function calling query
 */
export interface FunctionCallingResult {
  hasToolCall: boolean;
  toolCalls: Array<{
    toolName: string;
    arguments: Record<string, unknown>;
  }>;
  raw: unknown;
  provider: string;
  text?: string;
}

// ==================== CloudIntentEngine ====================

export class CloudIntentEngine {
  private llmClient: LLMClient;
  private config: CloudIntentEngineConfig;
  private availableTools: Tool[] = [];

  constructor(config: CloudIntentEngineConfig) {
    this.config = config;
    this.llmClient = getLLMClient();
    this.llmClient.configure({
      provider: config.llm.provider,
      apiKey: config.llm.apiKey || "",
      model: config.llm.model || LLMDefaults.MODEL,
      temperature: config.llm.temperature ?? LLMDefaults.TEMPERATURE,
      maxTokens: config.llm.maxTokens ?? LLMDefaults.MAX_TOKENS,
      timeout: config.llm.timeout ?? Timeouts.LLM_REQUEST,
    } as AIConfig);
  }

  /**
   * Set available tools for the engine
   */
  setAvailableTools(tools: Tool[]): void {
    this.availableTools = tools;
    logger.debug(`[CloudIntentEngine] Set ${tools.length} available tools`);
  }

  /**
   * Get available tools
   */
  getAvailableTools(): Tool[] {
    return [...this.availableTools];
  }

  /**
   * Step 1: Plan — Generate a tool execution plan from a user query.
   *
   * Uses LLM function calling to generate a structured plan (DAG) with:
   * - Tool selection based on available MCP tools
   * - Parameter extraction from the query
   * - Dependency ordering between steps
   *
   * The plan is returned WITHOUT executing any tools. The caller should:
   * 1. Present the plan to the user for confirmation
   * 2. Execute the plan after confirmation
   */
  async planQuery(
    query: string,
    options?: {
      systemPrompt?: string;
      model?: string;
      temperature?: number;
      toolChoice?: "auto" | "none";
    },
  ): Promise<ToolExecutionPlan> {
    logger.info(
      `[CloudIntentEngine] planQuery called: "${query.substring(0, 100)}..."`,
    );

    const startTime = Date.now();

    // Build the system prompt with available tools
    const systemPrompt = options?.systemPrompt || this.buildSystemPrompt();

    // Build the user message with the query
    const userMessage = this.buildUserMessage(query);

    try {
      // Determine tool choice mode
      const toolChoice = options?.toolChoice || "auto";

      // Call LLM with function calling
      const response = await this.llmClient.chat({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        temperature: options?.temperature,
        tools: toolChoice === "none" ? undefined : this.availableTools.map((tool) => ({
          type: "function" as const,
          function: {
            name: tool.name,
            description: tool.description || "",
            parameters: tool.inputSchema || { type: "object", properties: {} },
          },
        })),
        toolChoice,
      });

      // Parse the response into a plan
      const plan = this.parseResponseToPlan(query, response);

      const duration = Date.now() - startTime;
      logger.info(
        `[CloudIntentEngine] Plan generated in ${duration}ms with ${plan.steps.length} steps`,
      );

      return plan;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(`[CloudIntentEngine] planQuery failed: ${errorMessage}`);

      // Return a fallback plan
      return {
        id: `plan_${Date.now()}`,
        query,
        steps: [],
        confirmed: false,
        createdAt: new Date(),
        summary: `Failed to generate plan: ${errorMessage}`,
      };
    }
  }

  /**
   * Step 2: Confirm — Validate and confirm a plan with user interaction.
   *
   * Calls the confirmation callback to get user feedback on the plan.
   * The callback can:
   * - Confirm the plan as-is
   * - Modify the plan (e.g., reorder steps, change parameters)
   * - Reject the plan with feedback
   */
  async confirmPlan(
    plan: ToolExecutionPlan,
    confirmationCallback: PlanConfirmationCallback,
  ): Promise<ToolExecutionPlan> {
    logger.info(`[CloudIntentEngine] confirmPlan called for plan ${plan.id}`);

    // If the plan has no steps, auto-confirm
    if (plan.steps.length === 0) {
      logger.info("[CloudIntentEngine] Plan has no steps, auto-confirming");
      return {
        ...plan,
        confirmed: true,
        confirmedAt: new Date(),
      };
    }

    // Call the confirmation callback
    try {
      const response = await confirmationCallback(plan);

      if (response.confirmed) {
        const confirmedPlan: ToolExecutionPlan = {
          ...(response.modifiedPlan || plan),
          confirmed: true,
          confirmedAt: new Date(),
        };
        logger.info(`[CloudIntentEngine] Plan ${plan.id} confirmed by user`);
        return confirmedPlan;
      } else {
        logger.info(
          `[CloudIntentEngine] Plan ${plan.id} rejected by user: ${response.feedback || "no feedback"}`,
        );
        return {
          ...plan,
          confirmed: false,
          summary: `User cancelled the plan: ${response.feedback || "User did not provide feedback"}`,
        };
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        `[CloudIntentEngine] Confirmation callback failed: ${errorMessage}`,
      );
      return {
        ...plan,
        confirmed: false,
        summary: `Confirmation process error: ${errorMessage}`,
      };
    }
  }

  /**
   * Step 3: Execute — Execute a confirmed tool execution plan.
   *
   * Executes steps in dependency order with:
   * - Variable substitution ({{step_1.result}})
   * - Error handling per step
   * - Duration tracking
   */
  async executePlan(
    plan: ToolExecutionPlan,
    toolExecutor: (
      toolName: string,
      params: Record<string, unknown>,
    ) => Promise<unknown>,
  ): Promise<PlanExecutionResult> {
    logger.info(
      `[CloudIntentEngine] executePlan called for plan ${plan.id} with ${plan.steps.length} steps`,
    );

    const startTime = Date.now();

    if (!plan.confirmed) {
      logger.warn(
        "[CloudIntentEngine] Plan not confirmed, refusing to execute",
      );
      return {
        success: false,
        plan,
        stepResults: [],
        totalDuration: 0,
        finalResult: "Plan has not been confirmed. Call confirmPlan() first.",
      };
    }

    if (plan.steps.length === 0) {
      logger.warn("[CloudIntentEngine] Plan has no steps");
      return {
        success: true,
        plan,
        stepResults: [],
        totalDuration: 0,
        finalResult: "No steps to execute.",
      };
    }

    // Build execution context for variable substitution
    const context: ExecutionContext = {
      results: new Map(),
      variables: new Map(),
    };

    const stepResults: PlanExecutionResult["stepResults"] = [];

    // Topological sort to determine execution order
    const executionOrder = this.topologicalSortPlan(plan.steps);

    if (!executionOrder) {
      return {
        success: false,
        plan,
        stepResults: [],
        totalDuration: Date.now() - startTime,
        finalResult: "Circular dependency detected in plan",
      };
    }

    // Execute steps in order
    for (const stepId of executionOrder) {
      const step = plan.steps.find((s) => s.id === stepId);
      if (!step) {
        stepResults.push({
          stepId,
          toolName: "unknown",
          success: false,
          error: `Step ${stepId} not found in plan`,
          duration: 0,
        });
        continue;
      }

      const stepStartTime = Date.now();

      try {
        // Resolve parameters with variable substitution
        const resolvedArgs = this.resolvePlanParameters(
          step.arguments,
          context,
        );

        // Execute the tool
        const result = await toolExecutor(step.toolName, resolvedArgs);

        // Store result in context
        context.results.set(step.id, result);

        const duration = Date.now() - stepStartTime;

        stepResults.push({
          stepId: step.id,
          toolName: step.toolName,
          success: true,
          result,
          duration,
        });

        logger.info(
          `[CloudIntentEngine] Step ${step.id} (${step.toolName}) completed in ${duration}ms`,
        );
      } catch (error: unknown) {
        const duration = Date.now() - stepStartTime;
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        stepResults.push({
          stepId: step.id,
          toolName: step.toolName,
          success: false,
          error: errorMessage,
          duration,
        });

        logger.error(
          `[CloudIntentEngine] Step ${step.id} (${step.toolName}) failed: ${errorMessage}`,
        );

        // Stop execution on first failure
        break;
      }
    }

    const totalDuration = Date.now() - startTime;
    const success = stepResults.every((sr) => sr.success);
    const finalResult = success
      ? stepResults[stepResults.length - 1]?.result
      : undefined;

    return {
      success,
      plan,
      stepResults,
      finalResult,
      totalDuration,
    };
  }

  /**
   * Convenience method: Plan → Confirm → Execute in one call.
   *
   * This is the recommended entry point for the Plan-then-Execute flow.
   */
  async planAndExecute(
    query: string,
    confirmationCallback: PlanConfirmationCallback,
    toolExecutor: (
      toolName: string,
      params: Record<string, unknown>,
    ) => Promise<unknown>,
    options?: {
      systemPrompt?: string;
      model?: string;
      temperature?: number;
    },
  ): Promise<PlanExecutionResult> {
    logger.info(`[CloudIntentEngine] planAndExecute called: "${query}"`);

    // Step 1: Plan
    const plan = await this.planQuery(query, options);
    if (plan.steps.length === 0) {
      return {
        success: false,
        plan,
        stepResults: [],
        totalDuration: 0,
        finalResult: plan.summary,
      };
    }

    // Step 2: Confirm
    const confirmedPlan = await this.confirmPlan(plan, confirmationCallback);
    if (!confirmedPlan.confirmed) {
      return {
        success: false,
        plan: confirmedPlan,
        stepResults: [],
        totalDuration: 0,
        finalResult: confirmedPlan.summary,
      };
    }

    // Step 3: Execute
    return this.executePlan(confirmedPlan, toolExecutor);
  }

  /**
   * Process a query with multi-turn conversation history support.
   * This is used by the ExecuteService for the multi-turn LLM function calling flow.
   */
  async processQueryWithHistory(
    conversationHistory: Array<{ role: string; content: string }>,
    options?: {
      toolChoice?: "auto" | "none";
      model?: string;
      temperature?: number;
    },
  ): Promise<FunctionCallingResult> {
    logger.debug(
      `[CloudIntentEngine] processQueryWithHistory called with ${conversationHistory.length} messages`,
    );

    try {
      const response = await this.llmClient.chat({
        messages: conversationHistory as LLMMessage[],
        temperature: options?.temperature,
        tools: this.availableTools.map((tool) => ({
          type: "function" as const,
          function: {
            name: tool.name,
            description: tool.description || "",
            parameters: tool.inputSchema || { type: "object", properties: {} },
          },
        })),
        toolChoice: options?.toolChoice,
      });

      return this.parseFunctionCallingResponse(response);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        `[CloudIntentEngine] processQueryWithHistory failed: ${errorMessage}`,
      );
      return {
        hasToolCall: false,
        toolCalls: [],
        raw: null,
        provider: this.config.llm.provider,
        text: `Error: ${errorMessage}`,
      };
    }
  }

  // ==================== Private Methods ====================

  /**
   * Build the system prompt with available tools
   */
  private buildSystemPrompt(): string {
    const toolsDescription = this.availableTools
      .map((tool) => {
        const params = tool.inputSchema?.properties
          ? Object.entries(tool.inputSchema.properties)
              .map(([key, value]) => {
                const prop = value as Record<string, unknown>;
                return `  - ${key} (${(prop.type as string) || "string"}): ${(prop.description as string) || ""}`;
              })
              .join("\n")
          : "  No parameters";

        return `Tool: ${tool.name}
Description: ${tool.description || "No description"}
Parameters:
${params}`;
      })
      .join("\n\n");

    return `You are an intelligent assistant that generates structured execution plans.

You have access to the following MCP tools:

${toolsDescription}

Your task is to analyze the user's request and generate a plan that:
1. Selects the appropriate tools to fulfill the request
2. Extracts parameters from the user's query
3. Orders steps correctly (dependencies first)
4. Provides clear descriptions for each step

IMPORTANT: Return your response as a structured plan with steps. Each step must specify:
- The tool to use
- The parameters to pass
- Any dependencies on previous steps`;
  }

  /**
   * Build the user message with the query
   */
  private buildUserMessage(query: string): string {
    return `User request: ${query}

Please generate a structured execution plan to fulfill this request.`;
  }

  /**
   * Extract JSON object from text that may contain markdown code blocks,
   * surrounding explanatory text, or comments.
   *
   * Handles formats like:
   * - ```json\n{...}\n```
   * - ```\n{...}\n```
   * - { "summary": "...", "steps": [...] }
   * - Here is the plan: { "summary": "...", "steps": [...] }
   */
  private extractJsonFromText(text: string): Record<string, unknown> | null {
    if (!text) return null;

    // Strategy 1: Try to extract from markdown code block (```json ... ``` or ``` ... ```)
    const codeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)```/;
    const codeBlockMatch = text.match(codeBlockRegex);
    if (codeBlockMatch) {
      const jsonStr = codeBlockMatch[1].trim();
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed && typeof parsed === 'object') {
          logger.debug('[CloudIntentEngine] Successfully parsed JSON from markdown code block');
          return parsed as Record<string, unknown>;
        }
      } catch (e) {
        logger.debug(`[CloudIntentEngine] Failed to parse JSON from code block: ${(e as Error).message}`);
      }
    }

    // Strategy 2: Try to find JSON object by scanning for { and matching braces
    // This handles cases where JSON is embedded in surrounding text
    const jsonObjectRegex = /\{[\s\S]*?\}/g;
    const jsonMatches = text.match(jsonObjectRegex);
    if (jsonMatches) {
      for (const candidate of jsonMatches) {
        try {
          const parsed = JSON.parse(candidate);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            // Check if it looks like a plan (has steps or summary)
            if (parsed.steps || parsed.summary) {
              logger.debug('[CloudIntentEngine] Successfully parsed JSON from embedded text');
              return parsed as Record<string, unknown>;
            }
          }
        } catch {
          // Try next candidate
        }
      }
    }

    // Strategy 3: Try direct JSON.parse on the whole text (most common case)
    try {
      const trimmed = text.trim();
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') {
        logger.debug('[CloudIntentEngine] Successfully parsed JSON from direct text');
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Not valid JSON
    }

    // Strategy 4: Try to find the first { and last } and parse that substring
    // This handles cases where there's text before/after the JSON
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const jsonCandidate = text.substring(firstBrace, lastBrace + 1);
      try {
        const parsed = JSON.parse(jsonCandidate);
        if (parsed && typeof parsed === 'object') {
          logger.debug('[CloudIntentEngine] Successfully parsed JSON from brace-delimited text');
          return parsed as Record<string, unknown>;
        }
      } catch {
        // Not valid JSON
      }
    }

    logger.warn('[CloudIntentEngine] Failed to extract JSON from response text');
    return null;
  }

  /**
   * Parse LLM response into a ToolExecutionPlan
   *
   * Handles both the LLMClientResponse format (with toolCalls containing
   * {id, type, function: {name, arguments}}) and text-based JSON responses.
   */
  private parseResponseToPlan(
    query: string,
    response: LLMClientResponse,
  ): ToolExecutionPlan {
    const plan: ToolExecutionPlan = {
      id: `plan_${Date.now()}`,
      query,
      steps: [],
      confirmed: false,
      createdAt: new Date(),
      summary: "",
    };

    // Build a tool name -> server name lookup from available tools
    const toolServerMap = new Map<string, string>();
    for (const tool of this.availableTools) {
      const serverName = (tool as unknown as Record<string, unknown>)
        .serverName as string | undefined;
      if (serverName && !toolServerMap.has(tool.name)) {
        toolServerMap.set(tool.name, serverName);
      }
    }

    // Try to extract tool calls from the LLMClientResponse format
    if (response.toolCalls && response.toolCalls.length > 0) {
      plan.steps = response.toolCalls.map((tc, index) => {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments);
        } catch {
          args = {};
        }

        return {
          id: `step_${index + 1}`,
          toolName: tc.function.name,
          serverName: toolServerMap.get(tc.function.name),
          description: `Execute ${tc.function.name} with provided parameters`,
          arguments: args,
          dependsOn: index > 0 ? [`step_${index}`] : [],
        };
      });

      plan.summary = `Plan with ${plan.steps.length} steps using ${plan.steps.map((s) => s.toolName).join(", ")}`;
    } else if (response.text) {
      // Try to extract JSON from the response text using robust extraction
      const parsed = this.extractJsonFromText(response.text);
      if (parsed && parsed.steps && Array.isArray(parsed.steps)) {
        plan.steps = parsed.steps.map(
          (step: Record<string, unknown>, index: number) => ({
            id: (step.id as string) || `step_${index + 1}`,
            toolName: step.toolName as string,
            serverName:
              (step.serverName as string) ||
              toolServerMap.get(step.toolName as string),
            description: (step.description as string) || `Step ${index + 1}`,
            arguments: (step.arguments as Record<string, unknown>) || {},
            dependsOn: (step.dependsOn as string[]) || [],
          }),
        );
        plan.summary =
          (parsed.summary as string) ||
          `Plan with ${plan.steps.length} steps`;
      } else if (parsed && !parsed.steps) {
        // Parsed JSON but no steps field - use as summary
        plan.summary = response.text.substring(0, 200);
        logger.warn(`[CloudIntentEngine] Parsed JSON has no 'steps' field: ${JSON.stringify(parsed).substring(0, 200)}`);
      } else {
        // Could not parse JSON at all
        plan.summary = response.text.substring(0, 200);
        logger.warn(`[CloudIntentEngine] Could not parse JSON from response text: "${response.text.substring(0, 200)}..."`);
      }
    }

    return plan;
  }

  /**
   * Parse function calling response from LLMClientResponse format
   */

  private parseFunctionCallingResponse(
    response: LLMClientResponse,
  ): FunctionCallingResult {
    const result: FunctionCallingResult = {
      hasToolCall: false,
      toolCalls: [],
      raw: response.raw || null,
      provider: response.provider,
    };

    if (response.toolCalls && response.toolCalls.length > 0) {
      result.hasToolCall = true;
      result.toolCalls = response.toolCalls.map((tc) => {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments);
        } catch {
          args = {};
        }

        return {
          toolName: tc.function.name,
          arguments: args,
        };
      });
    }

    if (response.text) {
      result.text = response.text;
    }

    return result;
  }

  /**
   * Topological sort of plan steps
   * Returns ordered step IDs or null if circular dependency detected
   */
  private topologicalSortPlan(steps: PlanStep[]): string[] | null {
    const graph = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    // Initialize graph
    for (const step of steps) {
      graph.set(step.id, step.dependsOn || []);
      inDegree.set(step.id, 0);
    }

    // Calculate in-degrees: count of dependencies for each node
    // A node with 0 dependencies can be executed first
    for (const [nodeId, deps] of graph) {
      inDegree.set(nodeId, deps.length);
    }

    // Kahn's algorithm: start with nodes that have no dependencies
    const queue: string[] = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) {
        queue.push(id);
      }
    }

    const sorted: string[] = [];
    while (queue.length > 0) {
      const node = queue.shift()!;
      sorted.push(node);

      // Find all nodes that depend on 'node' and decrement their in-degree
      for (const [otherNode, deps] of graph) {
        if (deps.includes(node)) {
          const newDegree = (inDegree.get(otherNode) || 0) - 1;
          inDegree.set(otherNode, newDegree);
          if (newDegree === 0) {
            queue.push(otherNode);
          }
        }
      }
    }

    // Check for circular dependency
    if (sorted.length !== steps.length) {
      return null;
    }

    return sorted;
  }

  /**
   * Resolve plan parameters with variable substitution
   * Supports {{step_X.result}} and {{step_X.result.field}} syntax
   */
  private resolvePlanParameters(
    args: Record<string, unknown>,
    context: ExecutionContext,
  ): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(args)) {
      if (typeof value === "string" && value.includes("{{")) {
        resolved[key] = this.resolveTemplateString(value, context);
      } else if (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
      ) {
        resolved[key] = this.resolvePlanParameters(
          value as Record<string, unknown>,
          context,
        );
      } else if (Array.isArray(value)) {
        resolved[key] = value.map((item) => {
          if (typeof item === "string" && item.includes("{{")) {
            return this.resolveTemplateString(item, context);
          }
          if (typeof item === "object" && item !== null) {
            return this.resolvePlanParameters(
              item as Record<string, unknown>,
              context,
            );
          }
          return item;
        });
      } else {
        resolved[key] = value;
      }
    }

    return resolved;
  }

  /**
   * Resolve a template string with variable substitution
   */
  private resolveTemplateString(
    template: string,
    context: ExecutionContext,
  ): string {
    return template.replace(/\{\{(.+?)\}\}/g, (match, expression) => {
      const expr = (expression as string).trim();

      // Check for step result reference: step_X.result or step_X.result.field
      const stepResultMatch = expr.match(/^step_(\d+)\.result(?:\.(.+))?$/);
      if (stepResultMatch) {
        const stepId = `step_${stepResultMatch[1]}`;
        const fieldPath = stepResultMatch[2];
        const result = context.results.get(stepId);

        if (result === undefined) {
          logger.warn(
            `[CloudIntentEngine] Template variable ${match} not found in context`,
          );
          return match;
        }

        if (fieldPath) {
          // Navigate nested object path
          const value = this.getNestedValue(result, fieldPath);
          return value !== undefined ? String(value) : match;
        }

        return typeof result === "object"
          ? JSON.stringify(result)
          : String(result);
      }

      // Check for variable reference: var.name
      const varMatch = expr.match(/^var\.(.+)$/);
      if (varMatch) {
        const varName = varMatch[1];
        const value = context.variables.get(varName);
        if (value === undefined) {
          logger.warn(
            `[CloudIntentEngine] Variable ${varName} not found in context`,
          );
          return match;
        }
        return String(value);
      }

      // Unknown expression, return as-is
      logger.warn(`[CloudIntentEngine] Unknown template expression: ${expr}`);
      return match;
    });
  }

  /**
   * Get a nested value from an object using dot notation
   */
  private getNestedValue(obj: unknown, path: string): unknown {
    const keys = path.split(".");
    let current: unknown = obj;

    for (const key of keys) {
      if (current === null || current === undefined) {
        return undefined;
      }
      if (
        typeof current === "object" &&
        key in (current as Record<string, unknown>)
      ) {
        current = (current as Record<string, unknown>)[key];
      } else {
        return undefined;
      }
    }

    return current;
  }

  /**
   * Describe a tool call for logging
   */
  private describeToolCall(
    toolName: string,
    args: Record<string, unknown>,
  ): string {
    const paramSummary = Object.entries(args)
      .map(([key, value]) => {
        const valueStr =
          typeof value === "string"
            ? `"${value.substring(0, 50)}"`
            : String(value);
        return `${key}=${valueStr}`;
      })
      .join(", ");

    return `${toolName}(${paramSummary})`;
  }
}
